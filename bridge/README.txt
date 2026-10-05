Creator bridge: Blender blockouts on your own computer
=====================================================

This helper builds 3D blockouts for your Playground projects with the Blender installed on
this computer. Nothing is rendered on our servers.

1. Install Blender 4.2 or newer (blender.org) if you don't have it.
2. Unzip this folder anywhere.
3. Start it:
   - Windows: double-click start-windows.bat
   - Mac / Linux: open a terminal in this folder and run  python3 creator_bridge.py
4. Leave the window open. In the app, open a project's 3D step, pick shots and press
   "Build blockout". The helper runs Blender in the background and uploads the preview video,
   one still per shot and the .blend file to your project.

config.json holds this computer's connection key. Keep it private. To disconnect this computer,
remove it from the 3D step in the app; the helper then stops working.

If Blender is installed somewhere unusual, add its path to config.json, for example:
  "blender": "D:\\Apps\\Blender\\blender.exe"
