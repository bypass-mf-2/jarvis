from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model
from datasets import load_dataset
from trl import SFTTrainer

# Load base model
model_name = "meta-llama/Llama-3.2-7B"  # or codellama/CodeLlama-7b-hf
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    load_in_8bit=True,  # Use 8-bit quantization to save VRAM
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# Configure LoRA
lora_config = LoraConfig(
    r=16,  # Rank - higher = more capacity but slower
    lora_alpha=32,
    target_modules=["q_proj", "v_proj"],  # Which layers to adapt
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

model = get_peft_model(model, lora_config)

# Load your training data
dataset = load_dataset("json", data_files="training_data.jsonl")

# Training arguments
training_args = TrainingArguments(
    output_dir="./trevor-llama",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    logging_steps=10,
    save_steps=100,
    warmup_steps=100,
)

# Create trainer
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset["train"],
    args=training_args,
    peft_config=lora_config,
    dataset_text_field="text",  # Combine instruction + output
    max_seq_length=512,
)

# Train!
trainer.train()

# Save adapter
model.save_pretrained("./trevor-llama-lora")