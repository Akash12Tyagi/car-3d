import sys, glob, os, numpy as np, cv2, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
S = sys.argv[1]
opts = vision.ImageSegmenterOptions(base_options=BaseOptions(model_asset_path=f"{S}/models/selfie_multiclass_256x256.tflite"),
        running_mode=vision.RunningMode.IMAGE, output_confidence_masks=True)
seg = vision.ImageSegmenter.create_from_options(opts)
os.makedirs(f"{S}/masks", exist_ok=True)
files = sorted(glob.glob(f"{S}/frames/f*.png"))
for i, f in enumerate(files):
    bgr = cv2.imread(f); rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    H, W = rgb.shape[:2]
    # run on overlapping tiles around subject is overkill; run full frame + center crop and merge
    def run(img):
        r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
        bg = r.confidence_masks[0].numpy_view()
        return 1.0 - cv2.resize(bg, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_CUBIC)
    m = run(rgb)
    # second pass on a square crop around subject for more resolution
    x0 = W//2 - H//2 - 0
    sq = rgb[:, x0:x0+H]
    m2 = run(sq)
    m[:, x0:x0+H] = np.maximum(m[:, x0:x0+H]*0.3, m2) if False else 0.4*m[:, x0:x0+H] + 0.6*m2
    m = np.clip(m, 0, 1).astype(np.float32)
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)/255
    m = cv2.ximgproc.guidedFilter(guide=bgr, src=m, radius=6, eps=1e-3)
    m = np.clip((m-0.35)/0.3, 0, 1)
    cv2.imwrite(f"{S}/masks/m{i:04d}.png", (m*255).astype(np.uint8))
print(len(files))
