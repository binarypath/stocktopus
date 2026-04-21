#!/bin/bash
set -e

echo "=== Stocktopus Ollama Setup ==="

# Check if Ollama is already installed
if command -v ollama &> /dev/null; then
    echo "Ollama already installed: $(ollama --version)"
else
    echo "Installing Ollama..."
    if [[ "$(uname)" == "Darwin" ]]; then
        TMPDIR=$(mktemp -d)
        echo "Downloading Ollama for macOS..."
        curl -fsSL -o "$TMPDIR/Ollama.zip" "https://ollama.com/download/Ollama-darwin.zip"
        echo "Extracting..."
        unzip -q "$TMPDIR/Ollama.zip" -d "$TMPDIR"
        echo "Installing to /Applications..."
        cp -R "$TMPDIR/Ollama.app" /Applications/
        rm -rf "$TMPDIR"
        echo "Starting Ollama..."
        open /Applications/Ollama.app
        echo "Waiting for Ollama to start..."
        for i in {1..30}; do
            if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
                echo "Ollama is running."
                break
            fi
            sleep 1
        done
    else
        curl -fsSL https://ollama.ai/install.sh | sh
    fi
fi

# Verify Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Ollama is not running. Please start it:"
    echo "  macOS: open /Applications/Ollama.app"
    echo "  Linux: ollama serve"
    exit 1
fi

MODEL="${OLLAMA_MODEL:-gemma4}"
METHOD="${1:-auto}"

if [[ "$METHOD" == "huggingface" ]] || [[ "$METHOD" == "hf" ]]; then
    echo ""
    echo "=== Downloading GGUF from HuggingFace (faster) ==="
    echo ""
    echo "Choose a model variant:"
    echo "  1) gemma-4-26B-A4B (recommended: 26B total, 4B active — fast + smart)"
    echo "  2) gemma-4-E4B (4B — smallest, fastest)"
    echo "  3) gemma-4-31B (31B — largest, most capable)"
    echo ""
    read -p "Choice [1]: " CHOICE
    CHOICE="${CHOICE:-1}"

    MODELS_DIR="$HOME/.ollama/models/blobs"
    mkdir -p "$MODELS_DIR"

    case "$CHOICE" in
        1)
            HF_REPO="unsloth/gemma-4-26B-A4B-it-GGUF"
            GGUF_FILE="gemma-4-26B-A4B-it-Q4_K_M.gguf"
            MODEL_NAME="gemma4-26b-a4b"
            ;;
        2)
            HF_REPO="unsloth/gemma-4-E4B-it-GGUF"
            GGUF_FILE="gemma-4-E4B-it-Q4_K_M.gguf"
            MODEL_NAME="gemma4-e4b"
            ;;
        3)
            HF_REPO="unsloth/gemma-4-31B-it-GGUF"
            GGUF_FILE="gemma-4-31B-it-Q4_K_M.gguf"
            MODEL_NAME="gemma4-31b"
            ;;
        *)
            echo "Invalid choice"
            exit 1
            ;;
    esac

    DOWNLOAD_DIR="$(pwd)/.models"
    mkdir -p "$DOWNLOAD_DIR"
    GGUF_PATH="$DOWNLOAD_DIR/$GGUF_FILE"

    if [[ -f "$GGUF_PATH" ]]; then
        echo "GGUF already downloaded: $GGUF_PATH"
    else
        echo "Downloading $GGUF_FILE from HuggingFace..."
        curl -L -o "$GGUF_PATH" \
            "https://huggingface.co/$HF_REPO/resolve/main/$GGUF_FILE"
    fi

    echo "Creating Ollama model from GGUF..."
    cat > "$DOWNLOAD_DIR/Modelfile" <<EOF
FROM $GGUF_PATH

PARAMETER temperature 0.3
PARAMETER num_predict 4096

SYSTEM """You are a financial analyst AI. Analyze companies using provided data and return structured JSON analysis."""
EOF

    ollama create "$MODEL_NAME" -f "$DOWNLOAD_DIR/Modelfile"
    echo ""
    echo "Model created: $MODEL_NAME"
    echo "Set OLLAMA_MODEL=$MODEL_NAME in your environment"

else
    echo "Pulling $MODEL from Ollama registry..."
    ollama pull "$MODEL"
fi

echo ""
echo "=== Setup Complete ==="
ollama list
echo ""
echo "Test with: ollama run ${MODEL_NAME:-$MODEL} 'Analyze AAPL stock briefly'"
