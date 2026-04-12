#!/bin/bash
###############################################################################
#  JARVIS AI - Server Setup Script
#  Run as root from the project directory: sudo bash deploy/setup-server.sh
#
#  Installs all deps and sets up systemd services.
#  After running: JARVIS serves on port 22770
###############################################################################

set -e

# Use the directory where the script lives (one level up from deploy/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=22770

echo ""
echo "  ========================================"
echo "    JARVIS AI - Server Setup"
echo "    Project dir: $PROJECT_DIR"
echo "    Port: $PORT"
echo "  ========================================"
echo ""

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Run as root (sudo bash deploy/setup-server.sh)"
    exit 1
fi

# ── [1/7] System packages ────────────────────────────────────────────────────
echo "[1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq curl git build-essential python3 python3-pip python3-venv python3-dev portaudio19-dev ffmpeg poppler-utils tesseract-ocr

# ── [2/7] Node.js 22 ────────────────────────────────────────────────────────
echo "[2/7] Installing Node.js 22..."
NODE_MAJOR=$(node --version 2>/dev/null | grep -oP '(?<=v)\d+' || echo "0")
if [ "$NODE_MAJOR" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi
echo "  Node $(node --version)"

# ── [3/7] pnpm ──────────────────────────────────────────────────────────────
echo "[3/7] Installing pnpm..."
if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm
fi
echo "  pnpm $(pnpm --version)"

# ── [4/7] Ollama + models ───────────────────────────────────────────────────
echo "[4/7] Installing Ollama..."
if ! command -v ollama &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Make sure the daemon is running before pulling models
systemctl start ollama 2>/dev/null || true
sleep 3

echo "  Pulling models (this can take a while on first run)..."
# Chat model — small, fast, good for CPU-only
ollama pull llama3.2:3b 2>&1 | tail -n 1 || echo "  llama3.2:3b pull failed (will retry later)"
# Embeddings — required for ChromaDB vector search
ollama pull nomic-embed-text 2>&1 | tail -n 1 || echo "  nomic-embed-text pull failed (will retry later)"
# Vision — for image understanding in file ingestion
ollama pull llava 2>&1 | tail -n 1 || echo "  llava pull failed (will retry later)"
# Code-aware model
ollama pull qwen2.5-coder:7b 2>&1 | tail -n 1 || echo "  qwen2.5-coder:7b pull failed (will retry later)"

# ── [5/7] Node dependencies ─────────────────────────────────────────────────
echo "[5/7] Installing Node dependencies..."
cd "$PROJECT_DIR"
pnpm install

# ── [6/7] Python venv + dependencies ────────────────────────────────────────
echo "[6/7] Setting up Python virtual environment..."
python3 -m venv "$PROJECT_DIR/.venv"
"$PROJECT_DIR/.venv/bin/pip" install --upgrade pip -q
"$PROJECT_DIR/.venv/bin/pip" install -r requirements.txt -q
mkdir -p "$PROJECT_DIR/chroma-data"

# ── [7/7] systemd services ──────────────────────────────────────────────────
echo "[7/7] Installing systemd services..."

# Write jarvis.service
cat > /etc/systemd/system/jarvis.service << SVCEOF
[Unit]
Description=JARVIS AI Server
After=network.target chromadb.service ollama.service
Wants=chromadb.service ollama.service

[Service]
Type=simple
User=root
WorkingDirectory=$PROJECT_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOME=/root
EnvironmentFile=-$PROJECT_DIR/.env
ExecStart=$PROJECT_DIR/node_modules/.bin/tsx start-jarvis.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=jarvis

[Install]
WantedBy=multi-user.target
SVCEOF

# Write chromadb.service
cat > /etc/systemd/system/chromadb.service << SVCEOF
[Unit]
Description=ChromaDB Vector Store
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/.venv/bin/chroma run --path $PROJECT_DIR/chroma-data --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=chromadb

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable ollama chromadb jarvis
systemctl start ollama
sleep 2
systemctl start chromadb
sleep 2
systemctl restart jarvis

# ── Firewall ─────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    ufw allow $PORT/tcp
    echo "  Firewall: port $PORT opened"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "  ========================================"
echo "    JARVIS IS DEPLOYED"
echo "  ========================================"
echo ""
echo "  Access: http://$SERVER_IP:$PORT"
echo ""
echo "  Commands:"
echo "    systemctl status jarvis      # Check status"
echo "    systemctl restart jarvis     # Restart"
echo "    journalctl -u jarvis -f      # Live logs"
echo ""
echo "  All services start on boot automatically."
echo ""
