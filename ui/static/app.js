/**
 * Face ID + Blockchain Verification Pipeline
 * Interactive Dashboard Client Application
 */

document.addEventListener("DOMContentLoaded", () => {
  // State
  let currentImageFile = null;
  let currentSamplePath = "sample_images/sample_face.jpg";
  let currentImageUrl = null;
  let activeTab = "tab-pipeline";

  // Elements
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("imageFileInput");
  const dropzoneContent = document.getElementById("dropzoneContent");
  const previewContainer = document.getElementById("previewContainer");
  const faceCanvas = document.getElementById("faceDetectionCanvas");
  const removeImageBtn = document.getElementById("removeImageBtn");
  const imageUrlInput = document.getElementById("imageUrlInput");
  const loadUrlBtn = document.getElementById("loadUrlBtn");
  const runBtn = document.getElementById("runPipelineBtn");
  const thresholdRange = document.getElementById("thresholdRange");
  const thresholdDisplay = document.getElementById("thresholdValueDisplay");
  const sampleChips = document.querySelectorAll(".sample-chip");
  const navTabs = document.querySelectorAll(".nav-tab");
  const tabContents = document.querySelectorAll(".tab-content");
  const emptyState = document.getElementById("emptyState");
  const resultsContainer = document.getElementById("resultsContainer");
  const executionTimeDisplay = document.getElementById("executionTimeDisplay");

  // Initialize
  initHealthCheck();
  initSamples();
  loadSamplePreview(currentSamplePath);

  // --------------------------------------------------------------------------
  // Tab Navigation
  // --------------------------------------------------------------------------
  navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      navTabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));

      tab.classList.add("active");
      const targetId = tab.getAttribute("data-tab");
      document.getElementById(targetId).classList.add("active");
      activeTab = targetId;
    });
  });

  // --------------------------------------------------------------------------
  // Health & Network Info
  // --------------------------------------------------------------------------
  async function initHealthCheck() {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        document.querySelector(".network-name").textContent = data.network;
        document.querySelector(".chain-id-tag").textContent = data.chain_id;
        if (data.contract_address) {
          const shortAddr = `${data.contract_address.slice(0, 6)}...${data.contract_address.slice(-4)}`;
          document.getElementById("headerContractAddress").textContent = shortAddr;
          document.getElementById("cstatAddress").textContent = data.contract_address;
        }
        document.getElementById("cstatNetwork").textContent = data.network;
      }
    } catch (e) {
      console.warn("Backend health check failed:", e);
    }
  }

  // --------------------------------------------------------------------------
  // Sample Loader
  // --------------------------------------------------------------------------
  async function initSamples() {
    try {
      const res = await fetch("/api/samples");
      if (res.ok) {
        const data = await res.json();
        const container = document.getElementById("sampleChipsContainer");
        if (data.samples && data.samples.length > 0) {
          container.innerHTML = "";
          data.samples.forEach((s, idx) => {
            const btn = document.createElement("button");
            btn.className = `sample-chip ${idx === 0 ? 'active' : ''}`;
            btn.setAttribute("data-sample", s.path);
            btn.innerHTML = `
              <img src="${s.url}" alt="${s.filename}">
              <span>${s.filename}</span>
            `;
            btn.addEventListener("click", () => {
              document.querySelectorAll(".sample-chip").forEach(c => c.classList.remove("active"));
              btn.classList.add("active");
              currentImageFile = null;
              currentSamplePath = s.path;
              loadSamplePreview(s.path);
            });
            container.appendChild(btn);
          });
        }
      }
    } catch (e) {
      console.warn("Could not load samples:", e);
    }
  }

  function loadSamplePreview(samplePath) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = `/api/samples/${samplePath.split('/').pop()}`;
    img.onload = () => {
      renderImageOnCanvas(img);
      dropzoneContent.style.display = "none";
      previewContainer.style.display = "flex";
    };
  }

  // --------------------------------------------------------------------------
  // File Drag & Drop & Upload
  // --------------------------------------------------------------------------
  dropzone.addEventListener("click", (e) => {
    if (e.target !== removeImageBtn && !removeImageBtn.contains(e.target)) {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFile(e.target.files[0]);
    }
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageFile(e.dataTransfer.files[0]);
    }
  });

  removeImageBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentImageFile = null;
    currentSamplePath = null;
    currentImageUrl = null;
    fileInput.value = "";
    imageUrlInput.value = "";
    previewContainer.style.display = "none";
    dropzoneContent.style.display = "flex";
    document.querySelectorAll(".sample-chip").forEach(c => c.classList.remove("active"));
    resetStepper();
  });

  // Handle URL Load
  loadUrlBtn.addEventListener("click", () => handleUrlInput());
  imageUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUrlInput();
    }
  });

  function handleUrlInput() {
    const url = imageUrlInput.value.trim();
    if (!url) {
      showToast("Please enter an image URL", "warning");
      return;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      showToast("Please enter a valid URL starting with http:// or https://", "warning");
      return;
    }

    currentImageUrl = url;
    currentImageFile = null;
    currentSamplePath = null;
    document.querySelectorAll(".sample-chip").forEach(c => c.classList.remove("active"));

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      renderImageOnCanvas(img);
      dropzoneContent.style.display = "none";
      previewContainer.style.display = "flex";
      showToast("Internet image loaded successfully", "success");
    };
    img.onerror = () => {
      showToast("Could not preview image directly from browser (CORS). It will be fetched by server upon execution.", "info");
      // Still set URL for server to download
      dropzoneContent.style.display = "none";
      previewContainer.style.display = "flex";
    };
    img.src = url;
  }

  function handleImageFile(file) {
    currentImageFile = file;
    currentSamplePath = null;
    currentImageUrl = null;
    imageUrlInput.value = "";
    document.querySelectorAll(".sample-chip").forEach(c => c.classList.remove("active"));

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        renderImageOnCanvas(img);
        dropzoneContent.style.display = "none";
        previewContainer.style.display = "flex";
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function renderImageOnCanvas(img, bbox = null) {
    const ctx = faceCanvas.getContext("2d");
    const maxDim = 400;
    let w = img.width;
    let h = img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = (h / w) * maxDim;
        w = maxDim;
      } else {
        w = (w / h) * maxDim;
        h = maxDim;
      }
    }
    faceCanvas.width = w;
    faceCanvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    if (bbox) {
      // Draw Face Bounding Box Overlay
      const scaleX = w / img.naturalWidth;
      const scaleY = h / img.naturalHeight;
      const bx = bbox[0] * scaleX;
      const by = bbox[1] * scaleY;
      const bw = (bbox[2] - bbox[0]) * scaleX;
      const bh = (bbox[3] - bbox[1]) * scaleY;

      ctx.strokeStyle = "#00dfd8";
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, bw, bh);

      // Corner Accents
      ctx.strokeStyle = "#7928ca";
      ctx.lineWidth = 4;
      const corner = 12;
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(bx, by + corner); ctx.lineTo(bx, by); ctx.lineTo(bx + corner, by);
      ctx.stroke();
      // Top-Right
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + corner);
      ctx.stroke();
      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - corner); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + corner, by + bh);
      ctx.stroke();
      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - corner);
      ctx.stroke();

      // Label Tag
      ctx.fillStyle = "#7928ca";
      ctx.fillRect(bx, by - 22, 100, 20);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 10px Outfit, sans-serif";
      ctx.fillText("FACE DETECTED", bx + 6, by - 8);
    }
  }

  // --------------------------------------------------------------------------
  // Threshold Slider
  // --------------------------------------------------------------------------
  thresholdRange.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    thresholdDisplay.textContent = `${Math.round(val * 100)}% (${val.toFixed(2)})`;
  });

  // --------------------------------------------------------------------------
  // Stepper Visualizer
  // --------------------------------------------------------------------------
  function resetStepper() {
    document.querySelectorAll(".step-item").forEach(s => {
      s.classList.remove("active", "completed");
    });
    document.querySelectorAll(".step-line").forEach(l => {
      l.classList.remove("completed");
    });
  }

  function setStepActive(stepNum) {
    const item = document.querySelector(`.step-item[data-step="${stepNum}"]`);
    if (item) item.classList.add("active");
  }

  function setStepCompleted(stepNum) {
    const item = document.querySelector(`.step-item[data-step="${stepNum}"]`);
    if (item) {
      item.classList.remove("active");
      item.classList.add("completed");
    }
    const line = document.getElementById(`line${stepNum === 3 ? 3 : (stepNum === 5 ? 4 : stepNum)}`);
    if (line) line.classList.add("completed");
  }

  // --------------------------------------------------------------------------
  // Run Pipeline Execution
  // --------------------------------------------------------------------------
  runBtn.addEventListener("click", async () => {
    if (!currentImageFile && !currentSamplePath && !currentImageUrl) {
      showToast("Please upload an image, enter an image URL, or select a sample photo first", "warning");
      return;
    }

    runBtn.classList.add("loading");
    resetStepper();
    emptyState.style.display = "none";
    resultsContainer.style.display = "none";
    executionTimeDisplay.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;

    setStepActive(1);

    const formData = new FormData();
    if (currentImageFile) {
      formData.append("file", currentImageFile);
    } else if (currentImageUrl) {
      formData.append("image_url", currentImageUrl);
    } else {
      formData.append("sample_path", currentSamplePath);
    }
    formData.append("similarity_threshold", thresholdRange.value);

    const savedKey = localStorage.getItem("serpapi_api_key");
    if (savedKey) {
      formData.append("api_key", savedKey.trim());
    }

    try {
      const response = await fetch("/api/pipeline/run", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        showToast(`Pipeline error: ${data.error || "Execution failed"}`, "error");
        runBtn.classList.remove("loading");
        executionTimeDisplay.textContent = "Error";
        return;
      }

      // Step completion animations
      setStepCompleted(1);
      setStepActive(2);
      await delay(200);
      setStepCompleted(2);
      setStepActive(3);
      await delay(200);
      setStepCompleted(3);
      setStepActive(5);
      await delay(200);
      setStepCompleted(5);
      setStepCompleted(6);

      // Render Results
      renderPipelineResults(data);
      resultsContainer.style.display = "flex";
      executionTimeDisplay.innerHTML = `<i class="fa-solid fa-check-circle" style="color:#00f5a0"></i> Completed in ${data.total_duration_sec}s`;
      if (data.stage3_4 && data.stage3_4.best_match) {
        showToast("Verified match recorded on blockchain!", "success");
      } else {
        showToast(`Pipeline completed: ${data.stage3_4?.failure_reason || "No verified match found"}`, "info");
      }

    } catch (err) {
      showToast(`Network or execution error: ${err.message}`, "error");
      executionTimeDisplay.textContent = "Error";
    } finally {
      runBtn.classList.remove("loading");
    }
  });

  function renderPipelineResults(data) {
    const s1 = data.stage1;
    const s2 = data.stage2;
    const s34 = data.stage3_4;
    const s5 = data.stage5;
    const s6 = data.stage6;

    // Redraw canvas with Bounding Box
    if (s1.bounding_box) {
      const img = new Image();
      img.src = s1.original_base64;
      img.onload = () => renderImageOnCanvas(img, s1.bounding_box);
    }

    // Stage 1 Fields
    document.getElementById("faceCropImg").src = s1.face_crop_base64 || s1.original_base64;
    document.getElementById("s1Confidence").textContent = `${(s1.detection_probability * 100).toFixed(2)}%`;
    document.getElementById("s1Dimensions").textContent = `${s1.embedding_dimensions}-Dimensional Vector`;
    document.getElementById("s1ImageHash").textContent = s1.image_sha256;
    document.getElementById("s1EmbeddingHash").textContent = s1.embedding_sha256;

    // Stage 2 Candidates List
    document.getElementById("s2CandidateCount").textContent = `${s2.total_candidates} Candidate${s2.total_candidates === 1 ? '' : 's'}`;
    const candList = document.getElementById("candidatesList");
    candList.innerHTML = "";

    if (!s2.candidates || s2.candidates.length === 0) {
      candList.innerHTML = `
        <div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
          <i class="fa-solid fa-magnifying-glass" style="margin-bottom:0.5rem; opacity:0.5;"></i><br>
          No public reverse-image search matches found for this photo.
        </div>
      `;
    } else {
      s2.candidates.forEach(c => {
        const card = document.createElement("div");
        card.className = "candidate-card-item";
        card.innerHTML = `
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span class="candidate-platform-badge">${c.domain || 'web'}</span>
            <a href="${c.source_url}" target="_blank" class="candidate-link">${c.title || c.source_url}</a>
          </div>
          <span class="badge ${c.is_social ? 'badge-purple' : 'badge-cyan'}">${c.is_social ? 'Social Post' : 'Web Link'}</span>
        `;
        candList.appendChild(card);
      });
    }

    // Stages 3 & 4: Top Match
    const topContent = document.getElementById("topMatchContent");
    if (s34.best_match) {
      const bm = s34.best_match;
      topContent.innerHTML = `
        <div class="match-summary-row">
          <div style="flex:1;">
            <h4 style="font-size:1.05rem; margin-bottom:0.25rem;">${bm.title}</h4>
            <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem;">
              Domain: <strong style="color:var(--text-main);">${bm.domain}</strong> &bull; 
              URL: <a href="${bm.source_url}" target="_blank" style="color:var(--accent-cyan);">${bm.source_url}</a>
            </p>
            <p style="font-size:0.8rem; color:var(--accent-emerald);">
              <i class="fa-solid fa-circle-check"></i> ${bm.verification_notes}
            </p>
          </div>
          <div class="match-score-gauge">
            <div class="score-circle">
              ${bm.similarity_percentage}%
            </div>
            <div style="display:flex; flex-direction:column;">
              <span style="font-size:0.75rem; color:var(--text-muted);">Cosine Sim: <strong>${bm.cosine_similarity}</strong></span>
              <span style="font-size:0.75rem; color:var(--text-muted);">Euclidean Dist: <strong>${bm.euclidean_distance}</strong></span>
            </div>
          </div>
        </div>
      `;
    } else {
      topContent.innerHTML = `
        <div style="padding: 0.75rem 0; color:var(--accent-gold);">
          <i class="fa-solid fa-triangle-exclamation"></i> <strong>${s34.failure_reason || "No verified match found."}</strong>
          <p style="font-size:0.82rem; color:var(--text-muted); margin-top:0.35rem;">
            Zero false-positive policy: candidates are recorded only after their image is downloaded, a face is detected, and similarity reaches the configured threshold.
          </p>
        </div>
      `;
    }

    // Stage 5 & 6: Blockchain
    const bGrid = document.getElementById("blockchainDetailsGrid");
    if (s5.transaction_hash) {
      const rec = s6.record;
      bGrid.innerHTML = `
        <div class="b-field">
          <span class="meta-label">Network:</span>
          <span class="meta-val">${s5.network_name}</span>
        </div>
        <div class="b-field">
          <span class="meta-label">Block / Gas:</span>
          <span class="meta-val">Block #${s5.block_number} &bull; ${s5.gas_used.toLocaleString()} Gas</span>
        </div>
        <div class="b-field full-span">
          <span class="meta-label">Contract Address:</span>
          <div class="hash-box">
            <code>${s5.contract_address}</code>
            <button class="btn-copy" onclick="navigator.clipboard.writeText('${s5.contract_address}')"><i class="fa-regular fa-copy"></i></button>
          </div>
        </div>
        <div class="b-field full-span">
          <span class="meta-label">Transaction Hash (Proof):</span>
          <div class="hash-box">
            <code style="color:var(--accent-emerald);">${s5.transaction_hash}</code>
            <button class="btn-copy" onclick="navigator.clipboard.writeText('${s5.transaction_hash}')"><i class="fa-regular fa-copy"></i></button>
          </div>
        </div>
        ${rec ? `
        <div class="b-field full-span" style="margin-top:0.5rem; padding-top:0.75rem; border-top:1px solid var(--border-color);">
          <span class="meta-label" style="color:var(--accent-cyan); font-weight:600;"><i class="fa-solid fa-lock"></i> On-Chain Decoded Record:</span>
          <p style="font-size:0.82rem; margin-top:0.25rem;">
            Recorded At: <strong>${rec.timestamp_iso}</strong> &bull; Score: <strong>${rec.similarity_percentage}%</strong> &bull; By: <code>${rec.recorded_by}</code>
          </p>
        </div>` : ''}
        ${s5.is_live_network && s5.explorer_tx_url ? `
        <div class="b-field full-span">
          <a href="${s5.explorer_tx_url}" target="_blank" class="explorer-btn-link">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> View On PolygonScan Explorer
          </a>
        </div>` : `
        <div class="b-field full-span" style="margin-top:0.25rem;">
          <span class="badge badge-purple" style="font-size:0.75rem;">
            <i class="fa-solid fa-shield-halved"></i> Verified in Local EVM Registry (In-Memory Proof)
          </span>
          <p style="font-size:0.75rem; color:var(--text-dim); margin-top:0.35rem;">
            Note: To broadcast live to public PolygonScan (Amoy Testnet), set your <code>PRIVATE_KEY</code> in <code>.env</code> with testnet MATIC.
          </p>
        </div>`}
      `;
    } else {
      bGrid.innerHTML = `
        <div class="b-field full-span" style="text-align:center; padding: 1.5rem 1rem;">
          <i class="fa-solid fa-shield" style="font-size: 1.8rem; color: var(--text-dim); margin-bottom: 0.75rem;"></i>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 0.25rem;">
            No on-chain record written.
          </p>
          <span style="font-size: 0.8rem; color: var(--text-dim);">
            Per PRD Section 7, smart contract state is only updated when a candidate passes the biometric similarity threshold.
          </span>
        </div>
      `;
    }
  }

  // --------------------------------------------------------------------------
  // Independent Verify Tab
  // --------------------------------------------------------------------------
  const verifyModeHash = document.getElementById("verifyModeHash");
  const verifyModeFile = document.getElementById("verifyModeFile");
  const verifyHashArea = document.getElementById("verifyHashInputArea");
  const verifyFileArea = document.getElementById("verifyFileInputArea");
  const btnVerifyHash = document.getElementById("btnExecuteVerifyHash");
  const btnVerifyFile = document.getElementById("btnExecuteVerifyFile");
  const verifyOutcome = document.getElementById("verificationOutcome");

  verifyModeHash.addEventListener("click", () => {
    verifyModeHash.classList.add("active");
    verifyModeFile.classList.remove("active");
    verifyHashArea.style.display = "block";
    verifyFileArea.style.display = "none";
  });

  verifyModeFile.addEventListener("click", () => {
    verifyModeFile.classList.add("active");
    verifyModeHash.classList.remove("active");
    verifyFileArea.style.display = "block";
    verifyHashArea.style.display = "none";
  });

  btnVerifyHash.addEventListener("click", async () => {
    const hashVal = document.getElementById("verifyHashInput").value.trim();
    if (!hashVal) {
      showToast("Please enter an image SHA-256 hash", "warning");
      return;
    }
    const formData = new FormData();
    formData.append("image_hash", hashVal);
    executeVerificationQuery(formData);
  });

  btnVerifyFile.addEventListener("click", async () => {
    const fInput = document.getElementById("verifyFileInput");
    if (!fInput.files || !fInput.files[0]) {
      showToast("Please select an image file to verify", "warning");
      return;
    }
    const formData = new FormData();
    formData.append("file", fInput.files[0]);
    executeVerificationQuery(formData);
  });

  async function executeVerificationQuery(formData) {
    verifyOutcome.style.display = "block";
    verifyOutcome.innerHTML = `<div style="text-align:center; padding:2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Querying smart contract view function...</div>`;

    try {
      const res = await fetch("/api/blockchain/verify", {
        method: "POST",
        body: formData
      });
      const data = await res.json();

      if (data.found && data.record) {
        const r = data.record;
        verifyOutcome.innerHTML = `
          <div style="background:rgba(0, 245, 160, 0.08); border:1px solid rgba(0, 245, 160, 0.3); border-radius:var(--radius-md); padding:1.25rem;">
            <div style="display:flex; align-items:center; gap:0.5rem; color:var(--accent-emerald); font-weight:700; margin-bottom:0.75rem;">
              <i class="fa-solid fa-shield-check" style="font-size:1.25rem;"></i> AUTHENTIC ON-CHAIN RECORD FOUND
            </div>
            <div class="stage-meta-grid">
              <div class="meta-item full-width">
                <span class="meta-label">Image SHA-256:</span>
                <code style="color:#a78bfa; font-family:var(--font-mono); font-size:0.8rem;">${r.image_hash_hex}</code>
              </div>
              <div class="meta-item full-width">
                <span class="meta-label">Matched Social URL:</span>
                <a href="${r.match_url}" target="_blank" style="color:var(--accent-cyan); font-size:0.85rem;">${r.match_url}</a>
              </div>
              <div class="meta-item">
                <span class="meta-label">Similarity Score:</span>
                <span class="meta-val" style="color:var(--accent-gold);">${r.similarity_percentage}% (${r.similarity_score_bps} bps)</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Timestamp:</span>
                <span class="meta-val">${r.timestamp_iso}</span>
              </div>
              <div class="meta-item full-width">
                <span class="meta-label">Recorded By Address:</span>
                <code style="font-family:var(--font-mono); font-size:0.8rem;">${r.recorded_by}</code>
              </div>
            </div>
          </div>
        `;
      } else {
        verifyOutcome.innerHTML = `
          <div style="background:rgba(255, 0, 85, 0.08); border:1px solid rgba(255, 0, 85, 0.3); border-radius:var(--radius-md); padding:1.25rem;">
            <div style="color:var(--accent-red); font-weight:700; margin-bottom:0.5rem;">
              <i class="fa-solid fa-triangle-exclamation"></i> No On-Chain Record Found
            </div>
            <p style="font-size:0.85rem; color:var(--text-muted);">
              ${data.message || "This image hash has not been verified or recorded to the MatchRegistry smart contract."}
            </p>
          </div>
        `;
      }
    } catch (e) {
      verifyOutcome.innerHTML = `<div style="color:var(--accent-red);">Verification error: ${e.message}</div>`;
    }
  }

  // --------------------------------------------------------------------------
  // Contract Deploy Button
  // --------------------------------------------------------------------------
  const btnDeployContract = document.getElementById("btnDeployContract");
  btnDeployContract.addEventListener("click", async () => {
    btnDeployContract.disabled = true;
    btnDeployContract.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Deploying...`;

    try {
      const res = await fetch("/api/blockchain/deploy", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast(`MatchRegistry deployed at ${data.contract_address}`, "success");
        document.getElementById("cstatAddress").textContent = data.contract_address;
        document.getElementById("headerContractAddress").textContent = `${data.contract_address.slice(0,6)}...${data.contract_address.slice(-4)}`;
      } else {
        showToast("Contract deployment failed", "error");
      }
    } catch (e) {
      showToast(`Deployment error: ${e.message}`, "error");
    } finally {
      btnDeployContract.disabled = false;
      btnDeployContract.innerHTML = `<i class="fa-solid fa-rocket"></i> Deploy New Contract Instance`;
    }
  });

  // Copy Solidity Code
  document.getElementById("btnCopySolidity").addEventListener("click", () => {
    const code = document.getElementById("solidityCodeDisplay").textContent;
    navigator.clipboard.writeText(code);
    showToast("Solidity code copied to clipboard", "success");
  });

  // Copy Buttons handler
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-copy");
    if (btn && btn.dataset.target) {
      const targetEl = document.getElementById(btn.dataset.target);
      if (targetEl) {
        navigator.clipboard.writeText(targetEl.textContent);
        showToast("Hash copied to clipboard", "success");
      }
    }
  });

  // --------------------------------------------------------------------------
  // Settings Modal Handlers
  // --------------------------------------------------------------------------
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const cancelSettingsBtn = document.getElementById("cancelSettingsBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const settingsModal = document.getElementById("settingsModal");
  const serpApiKeyInput = document.getElementById("serpApiKeyInput");

  if (openSettingsBtn && settingsModal) {
    const saved = localStorage.getItem("serpapi_api_key");
    if (saved && serpApiKeyInput) {
      serpApiKeyInput.value = saved;
    }

    openSettingsBtn.addEventListener("click", () => {
      settingsModal.style.display = "flex";
      if (serpApiKeyInput) serpApiKeyInput.focus();
    });

    const hideModal = () => {
      settingsModal.style.display = "none";
    };

    if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", hideModal);
    if (cancelSettingsBtn) cancelSettingsBtn.addEventListener("click", hideModal);
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) hideModal();
    });

    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener("click", () => {
        const val = serpApiKeyInput ? serpApiKeyInput.value.trim() : "";
        if (val) {
          localStorage.setItem("serpapi_api_key", val);
          showToast("SerpApi Key saved successfully!", "success");
        } else {
          localStorage.removeItem("serpapi_api_key");
          showToast("SerpApi Key cleared", "info");
        }
        hideModal();
      });
    }
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = "toast";
    if (type === "error") toast.style.borderLeftColor = "#ff0055";
    if (type === "warning") toast.style.borderLeftColor = "#ffbe0b";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
});
