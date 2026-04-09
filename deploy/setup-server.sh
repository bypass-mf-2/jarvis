#!/bin/bash
###############################################################################
#  JARVIS AI - Server Setup Script
#  Run as root: sudo bash setup-server.sh
#
#  What this does:
#    1. Installs Node.js, pnpm, Python, Ollama
#    2. Creates a 'jarvis' system user
#    3. Installs project deps
#    4. Sets up systemd services (jarvis, chromadb, ollama)
#    5. Enables everything to start on boot
#
#  After running: your server serves JARVIS on port 22770
###############################################################################

set -e

INSTALL_DIR="/opt/jarvis-ai"
PORT=22770
SERVICE_USER="jarvis"

echo ""
echo "  ========================================"
echo "    JARVIS AI - Server Setup"
echo "    Install dir: $INSTALL_DIR"
echo "    Port: $PORT"
echo "  ========================================"
echo ""

# ── Must be root ──────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Run as root (sudo bash setup-server.sh)"
    exit 1
fi

# ── Install system dependencies ───────────────────────────────────────────────
echo "[1/8] Installing system packages..."
apt-get update -qq
apt-get install -y -qq curl git build-essential python3 python3-pip python3-venv

# ── Install Node.js 20 LTS ───────────────────────────────────────────────────
echo "[2/8] Installing Node.js..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi
echo "  Node $(node --version)"

# ── Install pnpm ─────────────────────────────────────────────────────────────
echo "[3/8] Installing pnpm..."
if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm
fi
echo "  pnpm $(pnpm --version)"

# ── Install Ollama ────────────────────────────────────────────────────────────
echo "[4/8] Installing Ollama..."
if ! command -v ollama &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
fi

# ── Create service user ──────────────────────────────────────────────────────
echo "[5/8] Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ── Set up project directory ──────────────────────────────────────────────────
echo "[6/8] Setting up project directory..."
if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR"
fi

# Copy project files (run this from the project root)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
    echo "  Copying project files..."
    rsync -a --exclude='node_modules' --exclude='.git' --exclude='chroma-data' "$SCRIPT_DIR/" "$INSTALL_DIR/"
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ── Install dependencies ─────────────────────────────────────────────────────
echo "[7/8] Installing dependencies..."
cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" pnpm install
pip3 install -r requirements.txt -q

# Create chroma-data dir
mkdir -p "$INSTALL_DIR/chroma-data"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/chroma-data"

# ── Install systemd services ─────────────────────────────────────────────────
echo "[8/8] Installing systemd services..."

# Copy service files
cp "$INSTALL_DIR/deploy/chromadb.service" /etc/systemd/system/
cp "$INSTALL_DIR/deploy/jarvis.service" /etc/systemd/system/

# Fix chroma path (might be in different location)
CHROMA_PATH=$(which chroma 2>/dev/null || echo "/usr/local/bin/chroma")
sed -i "s|/usr/local/bin/chroma|$CHROMA_PATH|g" /etc/systemd/system/chromadb.service

# Fix pnpm path
PNPM_PATH=$(which pnpm 2>/dev/null || echo "/usr/bin/pnpm")
sed -i "s|/usr/bin/pnpm|$PNPM_PATH|g" /etc/systemd/system/jarvis.service

# Reload and enable
systemctl daemon-reload
systemctl enable ollama chromadb jarvis
systemctl start ollama
sleep 2
systemctl start chromadb
sleep 2
systemctl start jarvis

# ── Open firewall port ────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    ufw allow $PORT/tcp
    echo "  Firewall: port $PORT opened"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ========================================"
echo "    JARVIS IS DEPLOYED"
echo "  ========================================"
echo ""
echo "  Access:    http://YOUR_SERVER_IP:$PORT"
echo ""
echo "  Commands:"
echo "    systemctl status jarvis      # Check status"
echo "    systemctl restart jarvis     # Restart"
echo "    systemctl stop jarvis        # Stop"
echo "    journalctl -u jarvis -f      # Live logs"
echo ""
echo "    systemctl status chromadb    # ChromaDB status"
echo "    systemctl status ollama      # Ollama status"
echo ""
echo "  All 3 services start on boot automatically."
echo ""
