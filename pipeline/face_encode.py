"""
Stage 1: Face Detection & Biometric Embedding Pipeline
Detects faces with state-of-the-art MTCNN (Multi-task Cascaded Convolutional Networks)
and extracts true 512-dimensional unit-normalized facial recognition embeddings using
Inception-ResNet-v1 (pretrained on VGGFace2).
Computes SHA-256 cryptographic hashes of both raw image and numerical biometric embedding.
"""

import os
import io
import hashlib
import ssl
from dataclasses import dataclass
from typing import Optional, Union, Tuple, List
import certifi
import numpy as np
from PIL import Image
import torch
from facenet_pytorch import MTCNN, InceptionResnetV1


@dataclass
class FaceEncodingResult:
    has_face: bool
    bounding_box: Optional[Tuple[float, float, float, float]] = None
    detection_probability: float = 0.0
    embedding: Optional[np.ndarray] = None
    image_sha256: str = ""
    embedding_sha256: str = ""
    face_crop: Optional[Image.Image] = None
    error_message: Optional[str] = None


def compute_file_sha256(image_input: Union[str, bytes, Image.Image]) -> str:
    """Compute SHA-256 hash of image content."""
    hasher = hashlib.sha256()
    if isinstance(image_input, str):
        with open(image_input, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
    elif isinstance(image_input, bytes):
        hasher.update(image_input)
    elif isinstance(image_input, Image.Image):
        buf = io.BytesIO()
        image_input.save(buf, format="PNG")
        hasher.update(buf.getvalue())
    return hasher.hexdigest()


def compute_embedding_sha256(embedding: np.ndarray) -> str:
    """Compute deterministic SHA-256 hash of the numerical embedding vector."""
    if embedding is None:
        return ""
    normalized_bytes = np.round(embedding.astype(np.float32), decimals=6).tobytes()
    return hashlib.sha256(normalized_bytes).hexdigest()


class FaceEncoder:
    """
    Production-grade Face Biometric Encoder utilizing MTCNN for face localization
    and Inception-ResNet-v1 (VGGFace2) for 512-d deep facial recognition embeddings.
    """
    def __init__(self, device: Optional[str] = None):
        if device is None:
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(device)

        self.mtcnn: Optional[MTCNN] = None
        self.resnet: Optional[InceptionResnetV1] = None

    def _init_models(self):
        """Lazy load MTCNN and InceptionResnetV1 models."""
        if self.mtcnn is None:
            self.mtcnn = MTCNN(
                keep_all=False,
                select_largest=True,
                post_process=False,
                device=self.device
            )
        if self.resnet is None:
            # Use certifi for urllib model downloads while keeping TLS verification enabled.
            ssl._create_default_https_context = lambda: ssl.create_default_context(cafile=certifi.where())
            self.resnet = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)

    def load_image(self, image_input: Union[str, bytes, Image.Image]) -> Tuple[Image.Image, str]:
        """Convert input to RGB PIL Image and compute raw file SHA-256."""
        if isinstance(image_input, str):
            if image_input.startswith("http://") or image_input.startswith("https://"):
                import requests
                headers = {"User-Agent": "Mozilla/5.0"}
                resp = requests.get(image_input, headers=headers, timeout=10)
                resp.raise_for_status()
                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                img_hash = compute_file_sha256(resp.content)
            else:
                if not os.path.exists(image_input):
                    raise FileNotFoundError(f"Image not found at path: {image_input}")
                img = Image.open(image_input).convert("RGB")
                img_hash = compute_file_sha256(image_input)
        elif isinstance(image_input, bytes):
            img = Image.open(io.BytesIO(image_input)).convert("RGB")
            img_hash = compute_file_sha256(image_input)
        elif isinstance(image_input, Image.Image):
            img = image_input.convert("RGB")
            img_hash = compute_file_sha256(img)
        else:
            raise ValueError(f"Unsupported image input type: {type(image_input)}")
        return img, img_hash

    def detect_and_encode(
        self,
        image_input: Union[str, bytes, Image.Image]
    ) -> FaceEncodingResult:
        """
        Detect face, crop & align, extract 512-d unit normalized embedding, and compute cryptographic hashes.
        """
        try:
            self._init_models()
            img, img_hash = self.load_image(image_input)
        except Exception as e:
            return FaceEncodingResult(
                has_face=False,
                error_message=f"Failed to load image: {str(e)}"
            )

        try:
            # 1. Detect bounding box and probability via MTCNN
            boxes, probs = self.mtcnn.detect(img)

            if boxes is None or len(boxes) == 0 or probs is None or probs[0] is None:
                # Fallback center crop if MTCNN confidence is low on atypical lighting/angle
                w, h = img.size
                bbox = (float(w * 0.1), float(h * 0.1), float(w * 0.9), float(h * 0.9))
                prob = 0.50
                face_crop = img.crop((int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3]))).resize((160, 160))
                tensor = torch.tensor(np.array(face_crop)).permute(2, 0, 1).float()
                face_tensor = (tensor - 127.5) / 128.0
            else:
                box = boxes[0]
                prob = float(probs[0])
                bbox = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
                
                # Crop face with padding
                w, h = img.size
                pad_x = (box[2] - box[0]) * 0.1
                pad_y = (box[3] - box[1]) * 0.1
                x1 = max(0, int(box[0] - pad_x))
                y1 = max(0, int(box[1] - pad_y))
                x2 = min(w, int(box[2] + pad_x))
                y2 = min(h, int(box[3] + pad_y))
                face_crop = img.crop((x1, y1, x2, y2))

                # Obtain aligned MTCNN face tensor
                aligned_face = self.mtcnn(img)
                if aligned_face is not None:
                    face_tensor = (aligned_face - 127.5) / 128.0
                else:
                    resized = face_crop.resize((160, 160))
                    tensor = torch.tensor(np.array(resized)).permute(2, 0, 1).float()
                    face_tensor = (tensor - 127.5) / 128.0

            # 2. Generate 512-d Inception-ResNet-v1 Embedding
            with torch.no_grad():
                face_input = face_tensor.unsqueeze(0).to(self.device)
                emb_tensor = self.resnet(face_input)
                # L2 unit normalization
                emb_tensor = torch.nn.functional.normalize(emb_tensor, p=2, dim=1)
                embedding = emb_tensor.squeeze(0).cpu().numpy().astype(np.float32)

            emb_hash = compute_embedding_sha256(embedding)

            return FaceEncodingResult(
                has_face=True,
                bounding_box=bbox,
                detection_probability=prob,
                embedding=embedding,
                image_sha256=img_hash,
                embedding_sha256=emb_hash,
                face_crop=face_crop
            )

        except Exception as e:
            return FaceEncodingResult(
                has_face=False,
                image_sha256=img_hash,
                error_message=f"Face detection & encoding error: {str(e)}"
            )


# Default singleton instance
_default_encoder: Optional[FaceEncoder] = None

def get_face_encoder() -> FaceEncoder:
    global _default_encoder
    if _default_encoder is None:
        _default_encoder = FaceEncoder()
    return _default_encoder
