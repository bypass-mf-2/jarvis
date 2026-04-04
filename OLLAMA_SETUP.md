# JARVIS AI - Ollama Setup Guide

This guide will help you set up **Ollama** on your Windows machine so JARVIS can run **LLaMA 3.2 locally** for completely offline, free AI inference.

## What is Ollama?

**Ollama** is a tool that lets you run large language models (LLMs) like LLaMA, Mistral, and others on your own computer. Once set up, you get:

- ✅ **Free** — no API costs
- ✅ **Offline** — no internet required after setup
- ✅ **Fast** — runs locally on your GPU/CPU
- ✅ **Private** — your data never leaves your machine

## System Requirements

- **Windows 10/11** (64-bit)
- **RAM**: 8GB minimum (16GB+ recommended for LLaMA 3.2)
- **Disk Space**: ~5GB for LLaMA 3.2 model
- **GPU** (optional but recommended): NVIDIA, AMD, or Apple Silicon for faster inference

## Step 1: Download & Install Ollama

1. Go to **https://ollama.com**
2. Click **Download** and select **Windows**
3. Run the installer (`OllamaSetup.exe`)
4. Follow the installation wizard (default settings are fine)
5. Ollama will start automatically as a background service

**Verify installation:**
- Open Command Prompt and run:
  ```bash
  ollama --version
  ```
- You should see a version number (e.g., `ollama version 0.1.x`)

## Step 2: Download LLaMA 3.2 Model

1. Open Command Prompt (or PowerShell)
2. Run:
   ```bash
   ollama pull llama3.2
   ```
3. **Wait** — this downloads ~5GB and may take 10-30 minutes depending on your internet speed
4. You'll see progress like:
   ```
   pulling manifest
   pulling 6a0746a1ec1a... 100% ▓▓▓▓▓▓▓▓▓▓ 5.2 GB
   verifying sha256 digest
   writing manifest
   success
   ```

**Verify the model is installed:**
```bash
ollama list
```
You should see `llama3.2` in the list.

## Step 3: Test Ollama is Running

1. Open Command Prompt
2. Run:
   ```bash
   ollama serve
   ```
3. You should see:
   ```
   Listening on 127.0.0.1:11434
   ```

This means Ollama is running and listening on `http://localhost:11434`.

**Note:** Ollama runs as a Windows service by default, so you don't need to manually start it every time. It will auto-start when you restart your computer.

## Step 4: Configure JARVIS to Use Ollama

JARVIS is already configured to use Ollama at `http://localhost:11434`. When you run JARVIS:

1. It will **automatically detect** if Ollama is running
2. If Ollama is online, it uses **LLaMA 3.2 locally**
3. If Ollama is offline, it falls back to cloud API (slower, but still works)

**To verify JARVIS is using Ollama:**
- Start JARVIS with `scripts\start.bat`
- Open http://localhost:3000
- Look at the **System Status** panel (bottom-left)
- It should show:
  - **LLM Model**: `llama3.2` (not "Fallback")
  - **Ollama**: `Online` (green indicator)

## Troubleshooting

### "Ollama not found" error
- **Solution**: Restart your computer after installing Ollama
- Or manually start Ollama: Open Command Prompt and run `ollama serve`

### "Connection refused" on localhost:11434
- **Solution**: Ollama is not running
  - Check Windows Services: Press `Win+R`, type `services.msc`, find "Ollama"
  - If stopped, right-click and select "Start"
  - Or manually run: `ollama serve` in Command Prompt

### Model download is slow
- **Solution**: This is normal. LLaMA 3.2 is ~5GB
- Leave it running and check back in 10-30 minutes
- You can monitor progress with: `ollama list`

### JARVIS still using "Fallback" instead of LLaMA
- **Solution**: 
  1. Make sure Ollama is running (`ollama serve`)
  2. Verify the model is installed: `ollama list`
  3. Restart JARVIS: Stop and run `scripts\start.bat` again
  4. Check System Status panel in JARVIS UI

### Out of memory errors
- **Solution**: LLaMA 3.2 needs ~8GB RAM
  - Close other applications
  - Or use a smaller model: `ollama pull mistral` (~4GB)
  - Update JARVIS config to use `mistral` instead of `llama3.2`

## Optional: Use a Different Model

If LLaMA 3.2 is too large, you can use **Mistral** (faster, smaller):

```bash
ollama pull mistral
```

Then update JARVIS to use it:
1. In JARVIS UI, go to **Settings** panel
2. Change **LLM Model** to `mistral`
3. Restart JARVIS

## Next Steps

Once Ollama is running with LLaMA 3.2:

1. **Start JARVIS**: Run `scripts\start.bat`
2. **Open browser**: http://localhost:3000
3. **Start chatting**: JARVIS will use your local LLaMA model
4. **Enjoy offline AI**: No internet required, no API costs!

## More Information

- **Ollama Docs**: https://github.com/ollama/ollama
- **Available Models**: https://ollama.ai/library
- **LLaMA 3.2 Details**: https://www.meta.com/blog/llama-3-2/
