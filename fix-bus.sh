#!/bin/bash

echo "🔧 Fixing JARVIS bugs..."

# 1. Fix AutoTrain import
echo "import { ollamaChat } from \"./ollama.js\";" | cat - server/AutoTrain.ts > temp && mv temp server/AutoTrain.ts

# 2. Rename files (Git-safe)
git mv server/AutoTrain.ts server/autoTrain.ts 2>/dev/null || mv server/AutoTrain.ts server/autoTrain.ts
git mv server/Codingai.ts server/codingAI.ts 2>/dev/null || mv server/Codingai.ts server/codingAI.ts
git mv server/Imagegeneration.ts server/imageGeneration.ts 2>/dev/null || mv server/Imagegeneration.ts server/imageGeneration.ts
git mv server/Voicecloning.ts server/voiceCloning.ts 2>/dev/null || mv server/Voicecloning.ts server/voiceCloning.ts
git mv server/Training-schema.ts server/training-schema.ts 2>/dev/null || mv server/Training-schema.ts server/training-schema.ts

# 3. Install missing Node dependencies
pnpm add mammoth pdf-parse sharp fluent-ffmpeg vm2

# 4. Install missing Python dependencies
pip install transformers peft datasets bitsandbytes accelerate trl

echo "✅ Basic fixes complete!"
echo "⚠️  Manual fixes still needed:"
echo "  1. Add training tables to drizzle/schema.ts"
echo "  2. Create trainingRouter.ts"
echo "  3. Add router to routers.ts"
echo "  4. Update all import paths after renaming"