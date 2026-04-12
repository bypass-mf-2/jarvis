# extract_code_examples.py
import os
import json

def extract_code_examples(directory):
    """Extract code examples from your projects"""
    examples = []
    
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.swift', '.py', '.ts', '.js')):
                filepath = os.path.join(root, file)
                with open(filepath, 'r') as f:
                    code = f.read()
                    
                    # Create training example
                    examples.append({
                        "instruction": f"Write {file} that does XYZ",  # You'll edit these
                        "output": code
                    })
    
    return examples

# Extract from your iOS projects
examples = extract_code_examples("/path/to/your/ios/projects")

# Save as training data
with open("training_data.jsonl", "w") as f:
    for ex in examples:
        f.write(json.dumps(ex) + "\n")