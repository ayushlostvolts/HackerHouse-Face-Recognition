"""
Face ID + Blockchain Verification Pipeline
Interactive Web UI Backend Server (FastAPI)
"""

import os
import sys
import io
import time
import base64
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

# Add root directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pipeline.face_encode import FaceEncoder, FaceEncodingResult, compute_file_sha256
from pipeline.reverse_search import ReverseImageSearcher, SearchCandidate
from pipeline.verify_match import CandidateVerifier, VerificationReport, VerifiedCandidate
from pipeline.blockchain_write import BlockchainClient, BlockchainWriteResult, OnChainRecord
from scripts.deploy_contract import deploy_contract

app = FastAPI(
    title="Face ID + Blockchain Verification Web UI",
    description="Interactive Testing & Verification Dashboard",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global singleton instances
face_encoder = FaceEncoder()
reverse_searcher = ReverseImageSearcher()
blockchain_client = BlockchainClient()


def pil_image_to_base64(img: Image.Image, format: str = "JPEG") -> str:
    """Convert PIL image to base64 data URI."""
    buffered = io.BytesIO()
    img.save(buffered, format=format)
    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
    mime = "image/jpeg" if format.upper() == "JPEG" else "image/png"
    return f"data:{mime};base64,{img_str}"


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "network": blockchain_client.network_name,
        "chain_id": blockchain_client.chain_id,
        "contract_address": blockchain_client.contract_address,
        "explorer_url": blockchain_client.explorer_url
    }


@app.get("/api/samples")
async def list_sample_images():
    """List sample test images available in sample_images/ directory."""
    samples_dir = os.path.join(os.path.dirname(__file__), "..", "sample_images")
    sample_files = []
    if os.path.exists(samples_dir):
        for f in os.listdir(samples_dir):
            if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                sample_files.append({
                    "filename": f,
                    "path": f"sample_images/{f}",
                    "url": f"/api/samples/{f}"
                })
    return {"samples": sample_files}


@app.get("/api/samples/{filename}")
async def get_sample_image(filename: str):
    """Serve a sample image."""
    filepath = os.path.join(os.path.dirname(__file__), "..", "sample_images", filename)
    if os.path.exists(filepath):
        return FileResponse(filepath)
    raise HTTPException(status_code=404, detail="Sample image not found")


@app.post("/api/pipeline/run")
async def run_full_pipeline(
    file: Optional[UploadFile] = File(None),
    sample_path: Optional[str] = Form(None),
    image_url: Optional[str] = Form(None),
    api_key: Optional[str] = Form(None),
    similarity_threshold: float = Form(0.60)
):
    """Execute complete 6-stage Face ID + Blockchain pipeline on uploaded, internet URL, or sample image."""
    start_time = time.time()

    # 1. Obtain image bytes and PIL Image
    if file:
        img_bytes = await file.read()
        try:
            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image file: {e}")
    elif image_url and (image_url.startswith("http://") or image_url.startswith("https://")):
        try:
            import requests
            headers = {"User-Agent": "Mozilla/5.0"}
            resp = requests.get(image_url, headers=headers, timeout=12)
            resp.raise_for_status()
            img_bytes = resp.content
            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch image from URL: {e}")
    elif sample_path:
        actual_path = os.path.join(os.path.dirname(__file__), "..", sample_path)
        if not os.path.exists(actual_path):
            raise HTTPException(status_code=404, detail="Sample image not found")
        with open(actual_path, "rb") as f:
            img_bytes = f.read()
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    else:
        raise HTTPException(status_code=400, detail="Must provide an image file, image_url, or sample_path")

    # =========================================================================
    # STAGE 1: Face Detection & 512-d Embedding
    # =========================================================================
    t1_start = time.time()
    enc_res: FaceEncodingResult = face_encoder.detect_and_encode(pil_img)
    t1_duration = round(time.time() - t1_start, 3)

    if not enc_res.has_face:
        return JSONResponse(status_code=422, content={
            "success": False,
            "stage_failed": 1,
            "error": enc_res.error_message or "No face detected in image",
            "image_sha256": enc_res.image_sha256
        })

    face_crop_base64 = pil_image_to_base64(enc_res.face_crop) if enc_res.face_crop else None
    original_base64 = pil_image_to_base64(pil_img)

    stage1_data = {
        "success": True,
        "detection_probability": enc_res.detection_probability,
        "bounding_box": enc_res.bounding_box,
        "embedding_dimensions": len(enc_res.embedding) if enc_res.embedding is not None else 0,
        "embedding_preview": enc_res.embedding[:8].tolist() if enc_res.embedding is not None else [],
        "image_sha256": enc_res.image_sha256,
        "embedding_sha256": enc_res.embedding_sha256,
        "face_crop_base64": face_crop_base64,
        "original_base64": original_base64,
        "duration_sec": t1_duration
    }

    # =========================================================================
    # STAGE 2: Reverse Image Search
    # =========================================================================
    t2_start = time.time()
    searcher = ReverseImageSearcher(serpapi_key=api_key) if api_key else reverse_searcher
    search_error = None

    try:
        if image_url and (image_url.startswith("http://") or image_url.startswith("https://")):
            candidates = searcher.search(image_url, embedding=enc_res.embedding, limit=12)
        else:
            temp_path = os.path.join(os.path.dirname(__file__), "..", "temp_query.jpg")
            pil_img.save(temp_path, format="JPEG")
            candidates = searcher.search(temp_path, embedding=enc_res.embedding, limit=12)
    except Exception as exc:
        candidates = []
        search_error = str(exc)

    t2_duration = round(time.time() - t2_start, 3)

    stage2_data = {
        "total_candidates": len(candidates),
        "error": search_error,
        "candidates": [
            {
                "title": c.title,
                "source_url": c.source_url,
                "image_url": c.image_url,
                "thumbnail_url": c.thumbnail_url,
                "domain": c.domain,
                "is_social": c.is_social,
                "engine": c.source_engine
            } for c in candidates
        ],
        "duration_sec": t2_duration
    }

    # =========================================================================
    # STAGES 3 & 4: Candidate Verification & Match Selection
    # =========================================================================
    t3_start = time.time()
    verifier = CandidateVerifier(similarity_threshold=similarity_threshold, encoder=face_encoder)
    report: VerificationReport = verifier.verify_candidates(enc_res.embedding, candidates)
    t3_duration = round(time.time() - t3_start, 3)

    evaluated_list = [
        {
            "candidate_title": ev.candidate.title,
            "source_url": ev.candidate.source_url,
            "domain": ev.candidate.domain,
            "is_social": ev.candidate.is_social,
            "is_match": ev.is_match,
            "cosine_similarity": round(ev.cosine_similarity, 4),
            "similarity_percentage": round(ev.cosine_similarity * 100, 2),
            "euclidean_distance": round(ev.euclidean_distance, 4),
            "similarity_score_bps": ev.similarity_score_bps,
            "verification_notes": ev.verification_notes
        } for ev in report.all_evaluated
    ]

    best_match_data = None
    if report.best_match:
        bm = report.best_match
        best_match_data = {
            "title": bm.candidate.title,
            "source_url": bm.candidate.source_url,
            "domain": bm.candidate.domain,
            "is_social": bm.candidate.is_social,
            "cosine_similarity": round(bm.cosine_similarity, 4),
            "similarity_percentage": round(bm.cosine_similarity * 100, 2),
            "euclidean_distance": round(bm.euclidean_distance, 4),
            "similarity_score_bps": bm.similarity_score_bps,
            "verification_notes": bm.verification_notes
        }

    stage3_4_data = {
        "matches_found": report.matches_found,
        "evaluated_candidates": evaluated_list,
        "best_match": best_match_data,
        "threshold": similarity_threshold,
        "failure_reason": (
            "Reverse-image search failed: " + search_error
            if search_error else
            "No reverse-image candidates were returned"
            if not candidates else
            "Candidate images could not be verified"
            if all(ev.verification_notes in {
                "Could not download candidate image",
                "No face detected in candidate image"
            } for ev in report.all_evaluated) else
            f"No candidate reached the {similarity_threshold:.0%} similarity threshold"
        ) if not best_match_data else None,
        "duration_sec": t3_duration
    }

    # =========================================================================
    # STAGE 5: Blockchain Write (MatchRegistry.sol)
    # =========================================================================
    t5_start = time.time()
    if best_match_data:
        write_res: BlockchainWriteResult = blockchain_client.write_match_record(
            image_sha256=enc_res.image_sha256,
            embedding_sha256=enc_res.embedding_sha256,
            match_url=best_match_data["source_url"],
            similarity_score_bps=best_match_data["similarity_score_bps"]
        )
    else:
        write_res = None
    t5_duration = round(time.time() - t5_start, 3)

    stage5_data = {
        "success": write_res.success if write_res else False,
        "is_live_network": write_res.is_live_network if write_res else False,
        "network_name": write_res.network_name if write_res else blockchain_client.network_name,
        "chain_id": write_res.chain_id if write_res else blockchain_client.chain_id,
        "contract_address": write_res.contract_address if write_res else blockchain_client.contract_address,
        "transaction_hash": write_res.transaction_hash if write_res else "",
        "block_number": write_res.block_number if write_res else 0,
        "gas_used": write_res.gas_used if write_res else 0,
        "recorded_by": write_res.recorded_by if write_res else "",
        "explorer_tx_url": write_res.explorer_tx_url if write_res else "",
        "explorer_contract_url": write_res.explorer_contract_url if write_res else "",
        "duration_sec": t5_duration
    }

    # =========================================================================
    # STAGE 6: On-Chain Verification Readout
    # =========================================================================
    t6_start = time.time()
    on_chain_rec: Optional[OnChainRecord] = blockchain_client.read_match_record(enc_res.image_sha256)
    t6_duration = round(time.time() - t6_start, 3)

    stage6_data = {
        "verified": on_chain_rec is not None and on_chain_rec.is_valid,
        "record": {
            "image_hash_hex": on_chain_rec.image_hash_hex,
            "encoding_hash_hex": on_chain_rec.encoding_hash_hex,
            "match_url": on_chain_rec.match_url,
            "similarity_score_bps": on_chain_rec.similarity_score_bps,
            "similarity_percentage": on_chain_rec.similarity_percentage,
            "timestamp": on_chain_rec.timestamp,
            "timestamp_iso": on_chain_rec.timestamp_iso,
            "recorded_by": on_chain_rec.recorded_by
        } if on_chain_rec else None,
        "duration_sec": t6_duration
    }

    total_duration = round(time.time() - start_time, 3)

    return {
        "success": True,
        "total_duration_sec": total_duration,
        "stage1": stage1_data,
        "stage2": stage2_data,
        "stage3_4": stage3_4_data,
        "stage5": stage5_data,
        "stage6": stage6_data
    }


@app.post("/api/blockchain/verify")
async def verify_record(
    file: Optional[UploadFile] = File(None),
    image_hash: Optional[str] = Form(None)
):
    """Independent verification endpoint: query blockchain for image file or SHA-256 hash."""
    if file:
        img_bytes = await file.read()
        target_hash = compute_file_sha256(img_bytes)
    elif image_hash:
        target_hash = image_hash.lower().replace("0x", "").strip()
    else:
        raise HTTPException(status_code=400, detail="Must provide an image file or image_hash")

    on_chain_rec = blockchain_client.read_match_record(target_hash)

    if on_chain_rec:
        return {
            "found": True,
            "image_hash": target_hash,
            "record": {
                "image_hash_hex": on_chain_rec.image_hash_hex,
                "encoding_hash_hex": on_chain_rec.encoding_hash_hex,
                "match_url": on_chain_rec.match_url,
                "similarity_score_bps": on_chain_rec.similarity_score_bps,
                "similarity_percentage": on_chain_rec.similarity_percentage,
                "timestamp": on_chain_rec.timestamp,
                "timestamp_iso": on_chain_rec.timestamp_iso,
                "recorded_by": on_chain_rec.recorded_by
            }
        }
    return {
        "found": False,
        "image_hash": target_hash,
        "message": f"No on-chain verification record found for hash: {target_hash}"
    }


@app.post("/api/blockchain/deploy")
async def deploy_new_contract():
    """Trigger smart contract deployment."""
    try:
        deployed_addr = deploy_contract()
        return {
            "success": True,
            "contract_address": deployed_addr,
            "network": blockchain_client.network_name,
            "explorer_url": f"{blockchain_client.explorer_url}/address/{deployed_addr}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


def start_server(host: str = "127.0.0.1", port: int = 8000):
    import uvicorn
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    start_server()
