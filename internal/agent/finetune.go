package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"stocktopus/internal/store"
)

// FineTuner manages training data export and Ollama model creation.
type FineTuner struct {
	store       *store.Store
	ollamaModel string
	outputDir   string
}

func NewFineTuner(st *store.Store, baseModel, outputDir string) *FineTuner {
	if baseModel == "" {
		baseModel = "gemma4"
	}
	return &FineTuner{
		store:       st,
		ollamaModel: baseModel,
		outputDir:   outputDir,
	}
}

// ExportTrainingData exports training pairs as JSONL for fine-tuning.
func (ft *FineTuner) ExportTrainingData(minQuality float64) (string, error) {
	pairs, err := ft.store.ExportTrainingData(minQuality)
	if err != nil {
		return "", fmt.Errorf("export: %w", err)
	}

	if len(pairs) == 0 {
		return "", fmt.Errorf("no training data above quality threshold %.1f", minQuality)
	}

	os.MkdirAll(ft.outputDir, 0755)
	filename := filepath.Join(ft.outputDir, fmt.Sprintf("training-%s.jsonl", time.Now().Format("20060102-150405")))

	f, err := os.Create(filename)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	for _, pair := range pairs {
		entry := map[string]string{
			"prompt":     pair.Prompt,
			"completion": pair.Completion,
		}
		if err := enc.Encode(entry); err != nil {
			return "", fmt.Errorf("encode: %w", err)
		}
	}

	return filename, nil
}

// GenerateModelfile creates an Ollama Modelfile for a fine-tuned model.
func (ft *FineTuner) GenerateModelfile(version string) (string, error) {
	os.MkdirAll(ft.outputDir, 0755)
	modelfile := filepath.Join(ft.outputDir, "Modelfile")

	content := fmt.Sprintf(`FROM %s

SYSTEM """You are a financial analyst AI trained on company analysis data from Stocktopus.
When given a company symbol and financial data, you produce structured analysis including:
- Executive summary
- Sentiment score (-1 to 1)
- Risk assessment (0-100)
- Key risks and opportunities
- Competitor analysis
- Sector outlook

Always respond with valid JSON matching the requested schema."""

PARAMETER temperature 0.3
PARAMETER num_predict 4096
`, ft.ollamaModel)

	if err := os.WriteFile(modelfile, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("write modelfile: %w", err)
	}

	return modelfile, nil
}

// CreateModel creates a new Ollama model from the Modelfile.
func (ft *FineTuner) CreateModel(version string) error {
	modelfile, err := ft.GenerateModelfile(version)
	if err != nil {
		return err
	}

	modelName := fmt.Sprintf("stocktopus-gemma-%s", version)
	cmd := exec.Command("ollama", "create", modelName, "-f", modelfile)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

// TrainingStats returns stats about available training data.
func (ft *FineTuner) TrainingStats() (int, error) {
	return ft.store.TrainingDataCount()
}
