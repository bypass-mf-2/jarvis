
import json
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from datasets import load_dataset
from trl import SFTTrainer

model_name = "llama3.2"
model = AutoModelForCausalLM.from_pretrained(model_name, load_in_8bit=True, device_map="auto")
tokenizer = AutoTokenizer.from_pretrained(model_name)
tokenizer.pad_token = tokenizer.eos_token

lora_config = LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj", "v_proj"], lora_dropout=0.05, bias="none", task_type=TaskType.CAUSAL_LM)
model = get_peft_model(model, lora_config)

dataset = load_dataset("json", data_files="C:\Users\trevo\Downloads\jarvis-ai v6\training-data\training-general-1775954796761.jsonl")

def format_prompt(example):
    return f"### Instruction:\n{example['instruction']}\n\n### Response:\n{example['output']}"

training_args = TrainingArguments(
    output_dir="./C:\Users\trevo\Downloads\jarvis-ai v6\custom-models/trevor-llama-1775954796782",
    num_train_epochs=3, per_device_train_batch_size=4, gradient_accumulation_steps=4,
    learning_rate=2e-4, logging_steps=10, save_steps=100, warmup_steps=50, fp16=True,
)

trainer = SFTTrainer(model=model, train_dataset=dataset["train"], args=training_args,
    peft_config=lora_config, formatting_func=format_prompt, max_seq_length=512)
trainer.train()
model.save_pretrained("./C:\Users\trevo\Downloads\jarvis-ai v6\custom-models/trevor-llama-1775954796782")
tokenizer.save_pretrained("./C:\Users\trevo\Downloads\jarvis-ai v6\custom-models/trevor-llama-1775954796782")
print("Training complete!")
