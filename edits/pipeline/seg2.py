import sys, os, subprocess, numpy as np, cv2, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
S, V = sys.argv[1], sys.argv[2]
opts = vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=f"{S}/models/selfie_multiclass_256x256.tflite"),
        running_mode=vision.RunningMode.IMAGE, output_confidence_masks=True)
seg = vision.ImageSegmenter.create_from_options(opts)
os.makedirs(f"{S}/masks_all", exist_ok=True)
W, H = 1920, 1080
p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", V, "-t", "20.45", "-vf", "scale=1920:1080:flags=lanczos",
                      "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
def run(img):
    r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
    return 1.0 - cv2.resize(r.confidence_masks[0].numpy_view(), (img.shape[1], img.shape[0]), interpolation=cv2.INTER_CUBIC)
i = 0
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    bgr = np.frombuffer(buf, np.uint8).reshape(H, W, 3); rgb = bgr[:, :, ::-1]
    m = run(rgb); x0 = W // 2 - H // 2
    m[:, x0:x0 + H] = 0.4 * m[:, x0:x0 + H] + 0.6 * run(rgb[:, x0:x0 + H])
    m = cv2.ximgproc.guidedFilter(guide=np.ascontiguousarray(bgr), src=np.clip(m, 0, 1).astype(np.float32), radius=6, eps=1e-3)
    m = np.clip((m - 0.35) / 0.3, 0, 1)
    cv2.imwrite(f"{S}/masks_all/m{i:05d}.png", (m * 255).astype(np.uint8)); i += 1
print("frames", i)
