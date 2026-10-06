Creator helper: the Playground's heavy work on your own computer
================================================================

This helper does two jobs for your Playground projects, on this computer. Nothing is rendered or
transcribed on our servers.
  - 3D blockouts (Production projects), with the Blender installed here.
  - Transcripts of your recordings (Studio projects), with whisper.cpp. The first transcription
    downloads the speech model (about 1.6 GB, once) and, on Windows, whisper.cpp itself.

1. You need Python 3 (python.org) or Blender 4.2 or newer (blender.org). Blockouts need Blender.
   On a Mac, transcription also needs whisper.cpp: brew install whisper-cpp
2. Unzip this folder anywhere.
3. Start it:
   - Windows: double-click start-windows.bat
   - Mac / Linux: open a terminal in this folder and run  python3 creator_bridge.py
4. Leave the window open. In the app, build a blockout from a project's 3D step, or upload a
   recording in a Studio project's Recording step. The helper picks the job up, does it here and
   uploads the result to your project.

config.json holds this computer's connection key. Keep it private. To disconnect this computer,
remove it in the app (3D visual or Recording step); the helper then stops working.

If Blender is installed somewhere unusual, add its path to config.json, for example:
  "blender": "D:\\Apps\\Blender\\blender.exe"
