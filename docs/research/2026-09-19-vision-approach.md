# Is YOLO the right vision approach for the memory glasses?

Researched 2026-09-19 against the plan in `README.md`. Numbers come from the linked primary sources. Section 7 lists what I could not confirm.

## 1. The answer

Yes for the hackathon, no for a product, and in both cases the detector is the part most likely to fail. Keep Ultralytics YOLOE-26 with text prompts at 1280 pixels as the write-time detector, because nothing else gets from `pip install` to boxes as fast. Change four things around it. Pick the three demo objects from classes that Objects365 and LVIS already cover, which means keys, wallet, remote, phone, eyeglasses or mug. Drop ByteTrack and confirm sightings by per-label voting across frames. Make the keyframe vision call verify the item as well as describe the spot. For "my keys", match DINOv2 crop embeddings against enrollment photos and skip YOLOE visual prompts. Two results drive this. MIT's MemPal, a near-identical system for older adults, ran on a VLM alone and [misidentified the object in 24% of trials](https://arxiv.org/html/2502.01801). The ESOM benchmark scores streaming egocentric object memory at [about 4% success with real detectors and trackers, and 81.92% with perfect ones](https://arxiv.org/abs/2411.16934). For a product, swap Ultralytics for an Apache-licensed RF-DETR or D-FINE fine-tune, because [AGPL-3.0 reaches the whole application](https://www.ultralytics.com/license).

## 2. Comparison across the five families

Speed is not the constraint here. At 2 to 5 fps each frame has 200 to 500 ms, and every detector below beats that on a GPU. Accuracy on small items and identity are the constraints.

| | 1. Closed-set, fine-tuned | 2. Open-vocabulary detector | 3. VLM only | 4. Embedding only | 5. Hybrid |
|---|---|---|---|---|---|
| Small objects in clutter | Best once trained. COCO small-object AP is 32.0 for RF-DETR-S and 32.6 for D-FINE-S against 26.1 for YOLO11-S, per [RF-DETR Table 2](https://arxiv.org/abs/2511.09554) | YOLOE-26 scores 24.7 to 40.6 AP on LVIS minival, and [Ultralytics says](https://docs.ultralytics.com/models/yoloe) a trained closed-set model beats it. SAM 3 reaches [53.6 LVIS box AP](https://github.com/facebookresearch/sam3) | Weak on boxes. Meta measured Gemini 2.5 at [16.1 cgF1 on LVIS boxes against 40.6 for SAM 3](https://github.com/facebookresearch/sam3). MemPal had [12% no-detection and 24% wrong-object trials](https://arxiv.org/html/2502.01801) | No localization. A key ring covers under 1% of a 720p frame, so a whole-frame vector barely encodes it. ORBIT shows clutter costs [10 to 15 points of frame accuracy](https://arxiv.org/abs/2104.03841) | Takes the detector's recall and the VLM's scene reading. The README already plans this |
| "My keys" versus any keys | None. A class is a class | YOLOE visual prompts return `object0` and are [scored at category level](https://docs.ultralytics.com/models/yoloe). OWLv2 has [one-shot image-guided detection](https://huggingface.co/docs/transformers/en/model_doc/owlv2) | Possible with a reference photo in the prompt. I found no benchmark | Strongest option. SAM plus DINOv2 matching beats trained instance detectors by [over 10 AP](https://arxiv.org/abs/2310.19257) | Detector proposes crops, DINO embeddings decide identity |
| Speed, published | RF-DETR-S [3.5 ms on T4](https://github.com/roboflow/rf-detr). YOLO26n [3.2 ms on iPhone 17 Pro](https://docs.ultralytics.com/integrations/coreml) | YOLOE-11-S [301 FPS on T4, 73 FPS on iPhone 12](https://github.com/THU-MIG/yoloe). Grounding DINO-T [9.4 FPS on A100](https://arxiv.org/html/2405.10300v2). SAM 3 [30 ms on H200](https://ai.meta.com/blog/segment-anything-model-3/) | Seconds per call. MemPal measured [11 s per GPT-4V call](https://arxiv.org/html/2502.01801) | Fast. Find My Things runs [100 to 200 ms per frame on an iPhone](https://cutrell.org/papers/Wen-CHI2024-Find-My-Things-Demo.pdf) | Detector speed in the loop, VLM off the loop |
| API cost per hour of wear | $0 | $0 when self-hosted | $1.45 to $24.97 on every frame at 2 fps, $0.01 to $0.21 at 60 keyframes. See section 3.3 | $0 self-hosted. $0.86 with Gemini Embedding 2 on every frame | Keyframe cost only, cents per hour |
| License | RF-DETR N to L, D-FINE, RT-DETR are Apache 2.0. YOLO26 and YOLO11 are AGPL-3.0 | YOLOE is AGPL-3.0. YOLO-World is GPL-3.0. Grounding DINO, LLMDet, OWLv2 are Apache 2.0. SAM 3 has its own license | Vendor terms. Qwen3.5 and Gemma 4 are Apache 2.0 | DINOv2 and SigLIP 2 are Apache 2.0. DINOv3 has its own license | Sum of the parts |
| Build time in 24 hours | 7 lines to train RF-DETR, plus 3 to 5 hours of collecting and labeling | About 6 lines for YOLOE on a webcam. Gotchas in section 3.2 | About 15 lines. Latency and box parsing are the gotchas | About 10 lines, but it cannot answer "where" alone | Detector plus one background job. Already scoped in M1 |
| Verdict | Product direction | Hackathon detector | Keyframes only | Identity and rooms only | The design to build |

## 3. Evidence by family

### 3.1 Closed-set detectors fine-tuned on our items

COCO has no keys, wallet or eyeglasses, and the README is right about that. Objects365 does. Its class list has [Key, Wallet/Purse, Remote, Glasses, Cell Phone, Handbag/Satchel, Watch and Cup](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/datasets/Objects365.yaml). So a detector pretrained on Objects365 sees those items with no training from us. D-FINE publishes such checkpoints, and they sit on Hugging Face as [`ustc-community/dfine-*-obj365` with an apache-2.0 tag](https://huggingface.co/ustc-community/dfine-medium-obj365). D-FINE-X scores [49.5 AP on the Objects365 validation set](https://github.com/Peterande/D-FINE). The same README warns that Objects365 checkpoints "may be subject to the Objects365 dataset terms", so treat them as a hackathon tool.

Pill bottle, pill organizer, hearing aid, charger and glasses case appear in neither Objects365 nor [the LVIS v1 category list](https://github.com/facebookresearch/detectron2/blob/main/detectron2/data/datasets/lvis_v1_categories.py). Those need text prompts, a VLM or our own training data.

Accuracy and speed of the current real-time detectors, COCO val2017:

| Model | COCO AP | COCO small-object AP | T4 TensorRT latency | License | Source |
|---|---|---|---|---|---|
| YOLO26s | 48.6 | not published by size | 2.5 ms | AGPL-3.0 | [Ultralytics docs](https://docs.ultralytics.com/models/yolo26) |
| YOLO26m | 53.1 | not published by size | 4.7 ms | AGPL-3.0 | [Ultralytics docs](https://docs.ultralytics.com/models/yolo26) |
| YOLO11-S | 44.4 | 26.1 | 3.2 ms | AGPL-3.0 | [RF-DETR README](https://github.com/roboflow/rf-detr), [RF-DETR paper](https://arxiv.org/abs/2511.09554) |
| RF-DETR-S | 53.0 | 32.0 | 3.5 ms | Apache 2.0 | same |
| RF-DETR-M | 54.7 | 36.1 | 4.4 ms | Apache 2.0 | same |
| D-FINE-S | 50.6 | 32.6 | 3.5 ms | Apache 2.0 | same |
| D-FINE-M | 55.0 | 37.6 | 5.4 ms | Apache 2.0 | same |
| RT-DETRv2-S | 48.1 | not checked | 217 FPS | Apache 2.0 | [RT-DETR README](https://github.com/lyuwenyu/RT-DETR) |

The RF-DETR rows are Roboflow measuring its own model against rivals, so read them as vendor numbers. Roboflow's YOLO26-S figure is 47.7 where Ultralytics reports 48.6. The pattern still holds across both sources. The DETR-style models lead YOLO11 on small objects by 6 to 8 AP at similar latency. Nobody has published the same split for YOLO26. COCO calls an object small under 32 by 32 pixels, which is where keys at arm's length land in a 720p frame.

RF-DETR also reports fine-tuning results on RF100-VL, a set of 100 small custom datasets. RF-DETR-S gets [60.2 AP against 57.0 for YOLO26-S](https://github.com/roboflow/rf-detr). That benchmark is the closest public stand-in for "200 photos of Dad's things".

Speed beyond the T4. Ultralytics measured YOLO26n INT8 Core ML on an iPhone 17 Pro at [3.2 ms with the Neural Engine and 9.2 ms on CPU](https://docs.ultralytics.com/integrations/coreml). It publishes no larger sizes. I found no first-party Apple Silicon MPS numbers for any of these. One third-party benchmark ran YOLO11m through Core ML on a MacBook Air M3 in [39.7 ms per frame](https://yolo.hexdocs.pm/macbook_air_m3.html), which is 25 fps and far above what we need.

Build time. RF-DETR fine-tuning is [a 7-line script on a COCO-format dataset, with batch size 4 and 4 accumulation steps on a T4](https://rfdetr.roboflow.com/learn/train/). The docs say nothing about training on MPS. An [open issue](https://github.com/roboflow/rf-detr/issues/427) reports a fine-tuned RF-DETR running on CPU only on an M1 Max at 2.59 FPS, so plan RF-DETR inference on CUDA. Labeling is the real cost. [Autodistill](https://github.com/autodistill/autodistill) labels a folder of images with Grounding DINO or GroundedSAM and trains a small detector from the result, which cuts hand labeling to review.

My read. This family wins a product and loses a 24-hour build. The README already treats fine-tuning as an optional experiment, and that is correct.

### 3.2 Open-vocabulary detectors

YOLOE-26 on LVIS minival, zero-shot, text prompt then visual prompt, from the [Ultralytics docs](https://docs.ultralytics.com/models/yoloe):

| Model | AP | AP rare | AP frequent | Params |
|---|---|---|---|---|
| YOLOE-26n | 24.7 / 21.9 | 20.5 / 17.6 | 26.1 / 22.4 | 3.9 M |
| YOLOE-26s | 30.8 / 28.6 | 23.9 / 25.1 | 33.0 / 29.9 | 10.7 M |
| YOLOE-26m | 35.4 / 33.9 | 31.1 / 33.4 | 36.9 / 33.8 | 21.3 M |
| YOLOE-26l | 37.8 / 36.3 | 35.1 / 37.6 | 38.5 / 36.1 | 25.5 M |
| YOLOE-26x | 40.6 / 38.5 | 37.4 / 35.3 | 41.0 / 38.8 | 55.2 M |

The frequent column matters more to us than the rare one. In LVIS v1, [key, wallet, remote_control, spectacles, cellular_telephone, handbag, mug, watch and water_bottle are frequent classes, and walking_cane and medicine are common](https://github.com/facebookresearch/detectron2/blob/main/detectron2/data/datasets/lvis_v1_categories.py). YOLOE also trains on [Objects365](https://docs.ultralytics.com/models/yoloe), so it has seen labeled keys and wallets.

The same docs page is blunt about limits. "Zero-shot accuracy is well below a model trained on your classes", and "Reach for YOLOE to cover classes you cannot train for, not to replace training". Neither the docs nor the [YOLO26 paper](https://arxiv.org/abs/2606.03748) reports small-object AP for YOLOE.

How the rest of the family compares on LVIS minival:

| Model | LVIS minival AP | Speed | Weights | Source |
|---|---|---|---|---|
| YOLO-Worldv2-S, M, L | 24.4, 32.4, 35.5 | 52 FPS on V100 for the L model at 35.4 AP | GPL-3.0 | [YOLOE docs](https://docs.ultralytics.com/models/yoloe), [YOLO-World paper](https://arxiv.org/abs/2401.17270), [repo](https://github.com/AILab-CVC/YOLO-World) |
| Grounding DINO-T | 27.4, rare 18.1 | 9.4 FPS PyTorch, 42.6 FPS TensorRT on A100 at 800 by 1333 | Apache 2.0 | [Grounding DINO 1.5 paper, Table 5](https://arxiv.org/html/2405.10300v2), [repo](https://github.com/IDEA-Research/GroundingDINO) |
| MM Grounding DINO-T | 41.4 | not published on the card | Apache 2.0 | [model card](https://huggingface.co/openmmlab-community/mm_grounding_dino_tiny_o365v1_goldg_v3det) |
| LLMDet Swin-T, B, L | 44.7, 48.3, 51.1, rare 37.3, 40.8, 45.1 | not published | Apache 2.0, in `transformers` since 4.55 | [LLMDet README](https://github.com/iSEE-Laboratory/LLMDet) |
| Grounding DINO 1.5 Edge | 36.2 | 75.2 FPS TensorRT on A100, over 10 FPS on Orin NX at 640 | API only | [paper](https://arxiv.org/abs/2405.10300) |
| Grounding DINO 1.5 Pro | 55.7 | not published | API only | [paper](https://arxiv.org/abs/2405.10300) |
| DINO-X Pro | 59.8, rare 63.3 | not published | API only, extra calls sold through WeChat Pay | [paper](https://arxiv.org/abs/2411.14347), [API repo](https://github.com/IDEA-Research/DINO-X-API) |
| OWLv2 L/14 | 44.6 AP rare on LVIS | not published | Apache 2.0 | [paper](https://arxiv.org/abs/2306.09683), [card](https://huggingface.co/google/owlv2-base-patch16-ensemble) |
| SAM 3 | 53.6 box AP, 48.5 mask AP on LVIS | 30 ms per image on H200, 848 M params | SAM License | [README](https://github.com/facebookresearch/sam3), [Meta blog](https://ai.meta.com/blog/segment-anything-model-3/) |
| OV-DEIM S, M, L | 2.0, 0.7, 0.4 AP above YOLOE-v8 S, M, L | T4 TensorRT, research code from March 2026 | Apache 2.0 | [paper](https://arxiv.org/abs/2603.07022), [repo](https://github.com/wleilei/OV-DEIM) |
| Florence-2 large | 37.5 COCO AP zero-shot, no LVIS number | not published | MIT | [model card](https://huggingface.co/microsoft/Florence-2-large) |

These rows mix LVIS protocols, so compare them loosely. The ordering is still clear. The Grounding DINO descendants and SAM 3 are 10 to 20 AP more accurate than the YOLO-style models, and far slower. Grounding DINO-T manages 9.4 FPS on an A100 where YOLOE-11-S does 301 FPS on a T4.

SAM 3 deserves a note because Meta tested it on our camera. Its video benchmark has a [SmartGlasses split of egocentric clips under CC-BY-4.0](https://github.com/facebookresearch/sam3/blob/main/scripts/eval/veval/README.md). SAM 3 scores [36.4 cgF1 there against 58.5 for humans](https://github.com/facebookresearch/sam3). Meta also says SAM 3 ["struggles to generalize to fine-grained out-of-domain concepts"](https://ai.meta.com/blog/segment-anything-model-3/). It is a poor fit for the live loop on a laptop. The repo requires [Python 3.12, PyTorch 2.7 and a CUDA 12.6 GPU, and the weights sit behind a Hugging Face access request](https://github.com/facebookresearch/sam3). Ultralytics wraps it in about six lines, but [the weights still need the manual gated download](https://docs.ultralytics.com/models/sam-3/). Request access at hour zero if you want it as an offline labeler.

Build time for YOLOE-26. A webcam loop is about six lines, namely load `yoloe-26s-seg.pt`, call `set_classes`, and iterate `predict(source=0, stream=True)`. The gotchas, all from the [YOLOE docs](https://docs.ultralytics.com/models/yoloe):

- The first `set_classes()` call pip-installs `ultralytics/CLIP` from GitHub and downloads a 254 MB text encoder into the current directory. Do this before the venue Wi-Fi does it for you.
- It needs `ultralytics` 8.4.0 or newer.
- The released weights are segmentation checkpoints. `yoloe-26l-seg.pt` is 35.4 M parameters and 142 GFLOPs, not the 25.5 M and 89 GFLOPs in the table.
- Visual prompts return `object0`, `object1`. You map names yourself.
- An exported model freezes its classes. `POST /config/classes` has to reload the `.pt` file, not the export.
- Prompt-free checkpoints reject `set_classes()`.

Grounding DINO through `transformers` is about a dozen lines, and the docs say to [separate classes with periods, as in "a cat. a dog."](https://huggingface.co/docs/transformers/en/model_doc/grounding-dino).

Small-object tricks. The source frame is 1280 wide, so run `imgsz=1280` and lose nothing to downscaling. Slicing with [SAHI](https://github.com/obss/sahi) is a second step. Its paper reports [5.1 to 6.8 AP gains from sliced inference](https://arxiv.org/abs/2202.06934), measured on aerial images, so expect less indoors. SAHI is MIT licensed and supports Ultralytics, `transformers` and RF-DETR models.

Tracking. The README pairs the detector with ByteTrack. ByteTrack associates boxes by IoU under a Kalman motion model, and its own paper says that on BDD100K ["large camera motion and the annotations are in low frame rate, which causes failure of motion cues"](https://ar5iv.labs.arxiv.org/html/2110.06864). A head-mounted camera at 2 to 5 fps is that case. With one enrolled instance per category, the MVP needs no track IDs at all. Count detections per label over a 2-second window. If a tracker is needed later, Ultralytics' BoT-SORT config ships with [`gmc_method: sparseOptFlow`, described as helping moving-camera scenes](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/trackers/botsort.yaml). Outside Ultralytics, [supervision](https://github.com/roboflow/supervision) is MIT and [roboflow/trackers](https://github.com/roboflow/trackers) is Apache 2.0.

My read. YOLOE-26 is the right hackathon pick on build time alone, and the wrong thing to trust blindly. Run a 30-minute bake-off at M0 on the recorded walkthrough. Compare YOLOE-26m text prompts against the D-FINE Objects365 checkpoint, and against LLMDet tiny if the perception box has CUDA. Count recall per object and keep the winner.

### 3.3 VLM only, no detector

The model lineups in the brief are stale. These are current as of today, read from first-party pricing pages. Two separate reads of each page agreed, but both went through a summarizer, so check the page before budgeting.

| Model | Input per 1M | Output per 1M | Source |
|---|---|---|---|
| gpt-5.6-luna | $0.20 | $1.20 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| gpt-5.6-terra | $2.00 | $12.00 | same |
| gpt-5.4-mini | $0.75 | $4.50 | same |
| gpt-5-nano, shuts down 2026-12-11 | $0.05 | $0.40 | same, [deprecations](https://developers.openai.com/api/docs/deprecations) |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | same |
| Gemini 3.8 Flash, promo through 2026-12-31 | $0.75 | $3.75 | same |
| qwen3-vl-flash | $0.05 | $0.40 | [Alibaba Model Studio](https://www.alibabacloud.com/help/en/model-studio/model-pricing) |
| Moondream 3.1 cloud | $0.30 | $1.00 | [Moondream pricing](https://moondream.ai/pricing) |

Image tokens for one 1280 by 720 frame. OpenAI's current models [count 32-pixel patches times a 1.2 multiplier](https://developers.openai.com/api/docs/guides/images-vision). That gives 40 by 23 patches, 920, times 1.2, so 1,104 tokens. Low detail resizes to 512 by 288 and costs 173 tokens. Gemini 3.x charges [1,120 tokens per image by default and 280 at low `media_resolution`](https://ai.google.dev/gemini-api/docs/media-resolution). Gemini 2.5 [tiles the image](https://ai.google.dev/gemini-api/docs/image-understanding), and a 720p frame makes 6 tiles of 258 tokens, so 1,548.

Cost per hour of wear. Each call carries one frame, 150 prompt tokens in and 80 tokens out. Every frame at 2 fps is 7,200 calls per hour. Keyframes are 60 or 300 calls per hour.

- gpt-5.6-luna, high detail. Input is 1,254 tokens at $0.20 per million, $0.0002508. Output is 80 tokens at $1.20 per million, $0.000096. One call costs $0.0003468. That is $2.50 per hour on every frame, $0.104 at 300 keyframes and $0.021 at 60.
- gpt-5.6-terra. Input $0.002508, output $0.00096, one call $0.003468. That is $24.97, $1.04 and $0.21.
- Gemini 2.5 Flash-Lite. Input is 1,698 tokens, $0.0001698. Output $0.000032. One call $0.0002018. That is $1.45, $0.061 and $0.012.
- Gemini 3.5 Flash-Lite. Input is 1,270 tokens, $0.000381. Output $0.0002. One call $0.000581. That is $4.18, $0.174 and $0.035.
- Gemini 3.8 Flash. Input $0.0009525, output $0.0003, one call $0.0012525. That is $9.02, $0.376 and $0.075, and it doubles on 2027-01-01.

These figures assume no reasoning tokens. GPT-5.6 and Gemini 3.x bill thinking as output, so set reasoning to minimal or the bill grows.

Cost does not rule out per-frame use. Latency does. OpenAI publishes no latency numbers. Roboflow, a third party, measured [about 5 seconds per image for Luna with reasoning on](https://blog.roboflow.com/openai-gpt-5-6/). MemPal measured [11 seconds per GPT-4V call and 26.16 seconds for its full vision pipeline](https://arxiv.org/html/2502.01801). A 2 fps stream gives each frame 500 ms.

Boxes. Gemini documents [`box_2d` output as ymin, xmin, ymax, xmax on a 0 to 1000 grid](https://ai.google.dev/gemini-api/docs/image-understanding). OpenAI documents no box format, and its vision guide still says the model ["struggles with tasks requiring precise spatial localization"](https://developers.openai.com/api/docs/guides/images-vision). Roboflow reports [mAP@50 of 43.3 to 46.2 for the GPT-5.6 models on its own unreleased benchmark, and 13.8 for GPT-5.5](https://blog.roboflow.com/openai-gpt-5-6/). Treat that as marketing until someone reproduces it. Meta measured Gemini 2.5 at [16.1 cgF1 on LVIS boxes, against 30.2 for OWLv2 and 40.6 for SAM 3](https://github.com/facebookresearch/sam3), and Meta has a stake in that table too. The RF100-VL benchmark found that [Grounding DINO and Qwen2.5-VL fall under 2% zero-shot AP on its hard out-of-domain sets](https://arxiv.org/abs/2505.20612).

Open-weight VLMs ground better than they did a year ago. The [Qwen3-VL report](https://arxiv.org/abs/2511.21631) gives ODinW-13 mAP of 43.4 for the 2B model, 48.2 for 4B and 48.6 for 235B. It lists Gemini 2.5 Pro at 33.7 on the same benchmark. Qwen3.5 is [Apache 2.0 and natively multimodal](https://huggingface.co/Qwen/Qwen3.5-4B), and its 9B card reports [RefCOCO average 89.7](https://huggingface.co/Qwen/Qwen3.5-9B). A third-party preprint measured Qwen3-VL-4B at [143 tokens per second on an M4 Max](https://arxiv.org/html/2601.19139v1).

Moondream 3.1 is a [9B mixture-of-experts model with 2B active and built-in detect and point skills](https://huggingface.co/moondream/moondream3.1-9B-A2B). Its vendor reports [COCO F1@0.5 of 81.46 against 77.06 for SAM 3](https://moondream.ai/blog/moondream-3-1-beyond-benchmarks), on its own harness with a metric nobody else uses. Its local runtime does [0.79 requests per second on an M2 Mac mini and 7.26 on an M5 Max](https://moondream.ai/blog/photon-1-2-0-update), also vendor numbers. Moondream 2 is [Apache 2.0 with 51.2 COCO detection AP](https://huggingface.co/vikhyatk/moondream2).

Small on-device VLMs, for the product question of running on the phone:

| Model | Boxes | License | Published Apple speed | Source |
|---|---|---|---|---|
| FastVLM 0.5B | no | Apple research license, bars product use | 166 ms to first token on M1 Max at 1024 px | [paper](https://arxiv.org/html/2412.13303v2), [repo](https://github.com/apple/ml-fastvlm) |
| SmolVLM2 256M to 2.2B | not documented | Apache 2.0, not confirmed here | none. The 500M runs on iPhone in HuggingSnap | [paper](https://arxiv.org/abs/2504.05299), [blog](https://huggingface.co/blog/smolvlm2) |
| Gemma 4 E2B, E4B | yes, `box_2d` | Apache 2.0 | none | [Gemma vision docs](https://ai.google.dev/gemma/docs/capabilities/vision/image) |
| LFM2.5-VL-450M | yes, RefCOCO-M 81.28 | LFM Open License | none. 242 ms on Jetson Orin at 512 px | [Liquid AI](https://www.liquid.ai/blog/lfm2-5-vl-450m) |
| LFM2.5-VL-3B | yes | same | 228 tokens per second decode on M5 Max | [Liquid AI](https://www.liquid.ai/blog/lfm2-5-vl-3b) |
| PaliGemma 2 3B | yes, `<loc>` tokens | Gemma license | none | [model card](https://huggingface.co/google/paligemma2-3b-mix-448) |
| Florence-2 0.23B, 0.77B | yes | MIT | none | [model card](https://huggingface.co/microsoft/Florence-2-large) |

All speeds in that table are the vendors' own.

Gemini's Live API takes video at ["max 1 frame per second"](https://ai.google.dev/gemini-api/docs/live-guide) and an audio-plus-video session [lasts 2 minutes unless context compression is on](https://ai.google.dev/gemini-api/docs/live-session). It is built for conversation about the current view, not for a day-long object log.

My read. MemPal is the existence proof and the warning. A VLM alone produced a working system that [raised retrieval accuracy from .81 to .97](https://arxiv.org/html/2502.01801). It also got the object wrong in 24% of trials and the location wrong in 22%. Use a VLM on keyframes, where it reads rooms and surfaces well, and let a detector find the item.

### 3.4 Embedding only, no detector

A whole-frame embedding answers "which frames look like a kitchen". It does not answer "where in this frame are the keys", and the keys are too few pixels to shape the vector. I found no benchmark for retrieving small household objects from frame-level embeddings, which is itself a signal. ORBIT is the nearest evidence. Its few-shot recognizers lose [10 to 15 points of frame accuracy when the object moves from a clean surface into clutter](https://arxiv.org/abs/2104.03841).

Crop embeddings are a different story, and they are the right tool for identity. The DINOv3 paper's instance-recognition table, from [Table 9](https://arxiv.org/html/2508.10104v1):

| Backbone | Oxford-Hard mAP | Met GAP | AmsterTime mAP |
|---|---|---|---|
| DINOv3 7B | 60.7 | 55.4 | 56.5 |
| DINOv2 g/14 | 58.2 | 44.6 | 48.9 |
| PE-core G/14 | 32.7 | 10.6 | 23.1 |
| SigLIP 2 g/16 | 25.1 | 13.9 | 15.5 |

Self-supervised DINO features beat SigLIP 2 by more than 2x on "is this the same object", and PE-core by almost as much. The small DINOv3 models keep most of it. The [model card](https://github.com/facebookresearch/dinov3/blob/main/MODEL_CARD.md) gives Oxford-Hard 49.5 for the 21 M ViT-S, 58.5 for ViT-B and 63.1 for ViT-L. These benchmarks are landmarks and artworks, so the transfer to key rings is my inference. SigLIP 2 and CLIP remain the better choice for matching text to images, which is what room naming needs.

API embeddings cost more than they are worth here. [Gemini Embedding 2 charges $0.00012 per image](https://ai.google.dev/gemini-api/docs/pricing), so 7,200 frames per hour is $0.86. [Voyage multimodal-3.5 charges $0.60 per billion pixels](https://docs.voyageai.com/docs/pricing). A 720p frame is 921,600 pixels, $0.00055, so every frame costs $3.98 per hour. A local DINOv2 or SigLIP 2 model costs nothing per frame.

Atlas limits that touch this. A vector field holds [at most 8192 dimensions](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/). A free cluster allows ["3 indexes (regardless of the type, `search` or `vector`)"](https://www.mongodb.com/docs/atlas/atlas-search/limitations/). Automated embedding is in preview and its [`modality` value must be `text`](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/), so image vectors are ours to compute. The README's roadmap already spends the 3 free indexes on sightings, rooms and full text. Identity matching should stay in memory, the same way the README handles fuzzy item names. One wearer has a few dozen items and a handful of reference vectors each.

My read. Embeddings cannot replace the detector. They should replace YOLOE visual prompts as the identity mechanism.

### 3.5 Hybrids

The README's plan is already a hybrid, and the literature backs the shape. Every strong VQ2D method in section 4 is a proposal stage followed by DINO-feature matching. MemPal and Encode-Store-Retrieve are both "cheap trigger, heavy model on selected frames, text into a vector store".

Three additions make the hybrid stronger at little cost.

- Verification. The keyframe call already sends the box. Ask the VLM to confirm the item is what the label says, and store the verdict. This catches detector false positives, which would otherwise become confident wrong answers. It costs no extra call.
- A recall sweep. Every 30 to 60 seconds of stable view, send one frame to Gemini Flash-Lite and ask which tracked items are visible, with `box_2d`. At 60 to 120 calls per hour this costs $0.01 to $0.07 by the arithmetic above. It covers the classes no detector has seen, such as a pill organizer.
- Hand state. MediaPipe's hand landmarker runs in [17 ms on a Pixel 6 CPU under Apache 2.0](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker). Overlap between a hand box and an item box gives the `held` state from pixels, which is more reliable than asking a VLM to judge motion from one still.

### 3.6 Personal-instance recognition

"My keys" is called instance detection in the literature, and the results are consistent.

- The InsDet benchmark found that SAM proposals plus DINOv2 features, with no training, beat end-to-end trained instance detectors by [more than 10 AP](https://arxiv.org/abs/2310.19257). The CVPR 2025 follow-up adds metric learning on the same features for [another 10 AP](https://arxiv.org/abs/2503.00359).
- EgoObjects reports [33.5 AP for category detection and 22.6 AP for instance detection](https://arxiv.org/abs/2309.08816) with the same backbone. AP drops by a third when the question moves from category to identity, on smart-glasses footage, with trained models.
- Microsoft's Seeing AI Find My Things ships this on iPhones. It uses [Prototypical Networks over a 4 M parameter EfficientNetB0 trained on ORBIT, enrolls from four short videos, and averages 80 frames into one embedding per object](https://cutrell.org/papers/Wen-CHI2024-Find-My-Things-Demo.pdf). Two of its lessons apply to our enrollment step. Teaching frames with blur and partial framing "lead to more robust model personalisation". More examples "did NOT lead to more reliable recognition", so they capped it at four videos.
- YOLOE visual prompts condition the model on ["objects that look like" the example](https://docs.ultralytics.com/models/yoloe), and the paper scores them per LVIS category. I found no evaluation of them separating two objects of one class. The README already says they "do not establish ownership", and I agree.
- OWLv2's [`image_guided_detection`](https://huggingface.co/docs/transformers/en/model_doc/owlv2) does one-shot detection from a query image under Apache 2.0. It is the fallback if the detector cannot propose the item at all.

The recipe that falls out. At enrollment, take 20 to 80 crops of the item, including blurry ones, embed them with DINOv2 small or base, and average them into one prototype. At run time, embed each detector crop of that class and compare by cosine similarity. Accept above a threshold and only when the margin over the next prototype is clear. Otherwise fall through to the README's `ambiguous` template.

### 3.7 Licensing

Ultralytics states the AGPL-3.0 terms broadly. Compliance means ["publicly releasing the complete corresponding source code for the entire derivative work, including the larger application"](https://www.ultralytics.com/license). That applies to SaaS and API deployments, to models you train yourself, and to internal use. The page lists "Personal projects, learning, and experimentation" and "Academic research and university coursework" as fitting AGPL-3.0. Everything commercial needs the paid Enterprise license, whose price is not public.

For the hackathon this is fine on one condition. Publish the repo under AGPL-3.0, the whole thing, web app included. A public repo under MIT with Ultralytics inside does not comply.

For a product it is a fork in the road. Buy the Enterprise license, or use a permissive detector. One more wrinkle. YOLOE-26's text prompts depend on a MobileCLIP2 text encoder, and Apple lists [MobileCLIP2-B weights under `apple-amlr`](https://huggingface.co/apple/MobileCLIP2-B), its research license. Apple's FastVLM weights use the same family of license, which [excludes product development](https://github.com/apple/ml-fastvlm).

| Component | License | Source |
|---|---|---|
| Ultralytics YOLO26, YOLO11, YOLOE, and its SAM 3 and YOLO-World wrappers | AGPL-3.0 or Enterprise | [license page](https://www.ultralytics.com/license) |
| Original YOLOE repo | AGPL-3.0 | [THU-MIG/yoloe](https://github.com/THU-MIG/yoloe) |
| YOLO-World | GPL-3.0, commercial license on request | [repo](https://github.com/AILab-CVC/YOLO-World) |
| RF-DETR Nano to Large, all segmentation sizes | Apache 2.0 | [repo](https://github.com/roboflow/rf-detr) |
| RF-DETR XL and 2XL detection | PML 1.0 | same |
| D-FINE | Apache 2.0, with a dataset-terms warning on Objects365 checkpoints | [repo](https://github.com/Peterande/D-FINE) |
| RT-DETR, RT-DETRv2, RT-DETRv4 | Apache 2.0 | [RT-DETR](https://github.com/lyuwenyu/RT-DETR), [RT-DETRv4](https://github.com/RT-DETRs/RT-DETRv4) |
| Grounding DINO, MM Grounding DINO, LLMDet | Apache 2.0 | [repo](https://github.com/IDEA-Research/GroundingDINO), [card](https://huggingface.co/openmmlab-community/mm_grounding_dino_tiny_o365v1_goldg_v3det), [repo](https://github.com/iSEE-Laboratory/LLMDet) |
| Grounding DINO 1.5, 1.6, DINO-X | closed weights, paid API | [API repo](https://github.com/IDEA-Research/DINO-X-API) |
| OWLv2 | Apache 2.0 | [card](https://huggingface.co/google/owlv2-base-patch16-ensemble) |
| Florence-2 | MIT | [card](https://huggingface.co/microsoft/Florence-2-large) |
| SAM 3 and 3.1 | SAM License, a custom grant to use, modify and redistribute, with trade-control terms | [LICENSE](https://github.com/facebookresearch/sam3/blob/main/LICENSE) |
| DINOv2 | Apache 2.0 | [repo](https://github.com/facebookresearch/dinov2) |
| DINOv3 | DINOv3 License. Commercial use allowed, "Built with DINOv3" notice when distributing, gated download | [license](https://ai.meta.com/resources/models-and-libraries/dinov3-license/) |
| SigLIP 2 | Apache 2.0 | [card](https://huggingface.co/google/siglip2-base-patch16-224) |
| supervision, SAHI | MIT | [supervision](https://github.com/roboflow/supervision), [SAHI](https://github.com/obss/sahi) |
| roboflow/trackers, MediaPipe, Autodistill | Apache 2.0 | [trackers](https://github.com/roboflow/trackers), [MediaPipe](https://github.com/google-ai-edge/mediapipe), [Autodistill](https://github.com/autodistill/autodistill) |

## 4. Egocentric research findings

### Ego4D visual queries

VQ2D is our problem stated as a benchmark. The query is ["a static image of an object, and the output response localizes the object the last time it was seen in the video"](https://ego4d-data.org/docs/benchmarks/episodic-memory/), and the docs' own example is a picture of my keys. The query is an image crop, never text. The benchmark covers [433 hours, over 22,000 queries and 3,000 object categories](https://arxiv.org/html/2411.16934).

Results on the test set, as tAP25, stAP25, recovery % and success %:

| Method | Test | Notes | Source |
|---|---|---|---|
| Ego4D SiamRCNN baseline | 0.21, 0.13, 34.0, 41.6 | 3 FPS | [Ego4D repo](https://github.com/EGO4D/episodic-memory/blob/main/VQ2D/README.md), [HERO-VQL table](https://arxiv.org/html/2509.00385) |
| CocoFormer, CVPR 2023 | 0.26, 0.18, 43.2, 48.1 | the "Where is my wallet" paper | [paper](https://arxiv.org/abs/2211.10528) |
| VQLoC | 0.32, 0.24, 45.11, 55.88 | 36 FPS, single stage | [paper](https://arxiv.org/abs/2306.09324) |
| PRVQL, ICCV 2025 | 0.37, 0.28, 45.70, 59.43 | 30 FPS | [paper](https://arxiv.org/html/2502.07707v1) |
| HERO-VQL, BMVC 2025 | 0.37, 0.28, 45.3, 60.7 | | [paper](https://arxiv.org/html/2509.00385) |
| RELOCATE | 0.43, 0.35, 50.6, 60.1 | training-free, SAM plus DINO plus SAM 2 | [paper](https://arxiv.org/html/2412.01826v2) |
| EgoHieraLoc, August 2026 | 0.44, 0.37, 51.28, 61.33 | | [paper](https://arxiv.org/html/2608.09656) |
| EAGLE, AAAI 2026 | 0.46, 0.40, 53.51, 62.70 | DINOv2 ViT-B, SAM, VGGT | [paper](https://arxiv.org/html/2511.08007) |

Read that as a ceiling. The best offline method, with the whole video in hand and a crop of the exact object, finds the last sighting 63% of the time. RELOCATE is the one to study because it needs no training, but it is far from real time. It reports [1,422.5 seconds to prepare a 1,000-frame video](https://arxiv.org/html/2412.01826v2).

ESOM is the result that matters most for us, because it is the streaming version. The model ["observ[es] each frame only once"](https://arxiv.org/abs/2411.16934) and keeps a compact object memory, which is our sightings collection. The best real configuration, a YOLOv10 pretrained on EgoObjects with an egocentric tracker, reaches about 4% success. With a perfect tracker it reaches 31.91%. With perfect object discovery, 40.55%. With both, 81.92%. The authors conclude that detection and tracking on real egocentric video are the bottleneck. Our task is easier than theirs in one way. We track 3 enrolled items, not every object in view. It is still the clearest warning in the literature that the memory design is fine and the detector is where the project lives or dies.

VQ3D answers with a 3D displacement. EgoLoc lifted test success [from 8.71% to 87.12%](https://arxiv.org/abs/2212.06969) by fixing camera pose estimation, and EAGLE is at [89.02%](https://arxiv.org/html/2511.08007). All of it depends on camera poses from COLMAP or VGGT. Ray-Ban Meta glasses give us video and nothing else, so 3D is out of reach for the hackathon.

### Datasets

| Dataset | What it has | License and access | Use for us | Source |
|---|---|---|---|---|
| EgoObjects | 114K frames from 9K videos, 368 categories, 14.4K instances, shot partly on Ray-Ban Stories | direct download, about 40 GB, LVIS format. Repo says MIT, Meta's page links a separate dataset agreement | best pretraining source for a product detector | [repo](https://github.com/facebookresearch/EgoObjects), [paper](https://arxiv.org/abs/2309.08816) |
| ORBIT | 3,822 videos of 486 personal objects, filmed by 77 blind and low-vision people. Keys, wallets, remotes, canes, sunglasses. Clean and clutter splits | direct download from figshare, code is MIT | identity evaluation, and the training set behind Find My Things | [paper](https://arxiv.org/abs/2104.03841), [repo](https://github.com/microsoft/ORBIT-Dataset) |
| SA-Co/VEval SmartGlasses | egocentric smart-glasses clips with noun-phrase masks | CC-BY-4.0 | small external test set from our camera type | [README](https://github.com/facebookresearch/sam3/blob/main/scripts/eval/veval/README.md) |
| HD-EPIC | 41 hours, 20K object movements annotated "from pick-up to placement" | license not confirmed | the only put-down ground truth I found | [paper](https://arxiv.org/abs/2502.04144) |
| EPIC-KITCHENS-100, VISOR | 100 hours, 300 noun classes, kitchens only. VISOR adds 272K masks and 67K hand-object relations | CC BY-NC 4.0 | research only | [site](https://epic-kitchens.github.io/2026), [VISOR](https://arxiv.org/abs/2209.13064) |
| HOI4D | 2.4M RGB-D frames, 16 categories | CC BY-NC 4.0 | research only | [site](https://hoi4d.github.io/) |
| Ego4D, Ego-Exo4D | 7.1 TB and 14 TiB | signed license, about 48 hours to approve | too slow for this weekend | [Ego4D docs](https://ego4d-data.org/docs/start-here/) |
| LVIS, Objects365 | our item classes, not egocentric | see family 1 | pretraining | section 3.1 |

### Catching the put-down

The purpose-built detectors are too heavy for 24 hours. The 100DOH hand-object detector is a Faster R-CNN that reaches [90.4 hand AP and 66.3 object AP](https://arxiv.org/abs/2006.06669), and it needs [PyTorch 1.12, CUDA 11.3 and compiled ops](https://github.com/ddshan/hand_object_detector). [Hands23](https://github.com/EvaCheng-cty/hands23_detector) and [EgoHOS](https://arxiv.org/abs/2208.03826) need detectron2 or mmcv on an NVIDIA GPU. [HaMeR](https://github.com/geopavlakos/hamer) needs a MANO download behind registration. WiLoR runs at [over 130 FPS on an RTX 4090](https://arxiv.org/html/2409.12259) but is CC-BY-NC-ND.

MediaPipe Hand Landmarker is the one that installs in a minute. It is [Apache 2.0 and takes 17.12 ms on a Pixel 6 CPU](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker). Evidence on egocentric video is mixed. One benchmark found its detector ["performs well for egocentric images"](https://arxiv.org/html/2409.07337v1). Another saw success fall [to 9.3% under hand occlusion](https://arxiv.org/abs/2603.11383).

Trained models locate the moment of state change to within [0.516 to 0.656 seconds on Ego4D's point-of-no-return task](https://arxiv.org/abs/2211.08728). At 2 fps a frame is 0.5 seconds, so the best trained model is one frame off at our sampling rate.

Is put-down detection realistic in 24 hours? A learned detector, no. A heuristic, yes, in about 3 hours after M3. Build a hand box from MediaPipe landmarks and grow it 25%. Mark the item `held` when its box overlaps the hand box for 2 frames. Mark it placed when the overlap ends and the item box holds still for a second. Expect it to miss. A temple-mounted camera often cannot see hands at waist height, and 2 fps gives one or two frames per put-down. MemPal pointed its camera ["towards the user's hands"](https://arxiv.org/html/2502.01801) and users still had to place objects deliberately in view. Ship "last confident sighting" first. It is what VQ2D scores and what MemPal speaks.

Two research systems show where this goes. AMEGO builds hand-object tracklets online from the 100DOH detector, an egocentric tracker and DINOv2, and scores [36.3% on its question benchmark](https://arxiv.org/html/2409.10917v1), yet ESOM measured it at [0.67% on streaming VQ2D](https://arxiv.org/html/2411.16934). "Out of Sight, Not Out of Mind" found that objects are [out of view for 85% of frames and that its 3D tracker still places 64% of them after 1 minute and 37% after 10](https://arxiv.org/html/2404.05072v1).

### Systems that already do this

MemPal, from the MIT Media Lab, is the closest published system. [An iPhone on a neck mount feeds tiled frames to GPT-4V, which writes the location, held objects and activity into a text diary. CLIP embeddings and a 5-minute calibration tour identify the room. A vector store and an LLM answer the question](https://arxiv.org/html/2502.01801). The spoken answer is "Your [object] was last seen at [time] in the [location] near [background]", which is the README's template almost word for word. What they measured:

- 15 adults aged 62 to 96, in their own homes, 3 with mild cognitive impairment and none with dementia.
- Retrieval accuracy rose from .81 unaided to .97, and rooms searched fell from 1.93 to 1.10.
- Query answers took 2.17 seconds on average. Vision logging took 26 seconds per step and ran in the background.
- Audio descriptions were right 72% of the time and retrieved images 53%. Across 92 trials the object was wrong in 24%, the location wrong in 22%, and nothing was detected in 12%.
- Participants wanted audio and the image together, wanted "which drawer" detail, found a body camera less intrusive than room cameras, and needed several tries with speech recognition.

Three lessons for us. The architecture in the README is validated by a real user study. Write-time processing is not optional, since their vision step took 26 seconds. Object identification was their largest error source, which is the case for adding a detector and a verification step.

Seeing AI Find My Things, from Microsoft Research, is the shipped answer to "my keys". Section 3.6 covers its method. It finds enrolled objects [up to 4 metres away](https://cutrell.org/papers/Wen-CHI2024-Find-My-Things-Demo.pdf) and was designed with 8 blind or low-vision young people.

Others, briefly. [Encode-Store-Retrieve](https://arxiv.org/html/2308.05822v2) captions HoloLens video at 4 fps into a vector store and beat human recall 4.1 to 2.5 out of 5 after a week, and it "struggles to capture temporal correlations". [EgoLife](https://arxiv.org/abs/2503.03803) does the same over 300 hours. Google Lookout's Find mode covers [seven generic categories with direction and distance](https://blog.google/company-news/outreach-and-initiatives/accessibility/ai-accessibility-update-gaad-2024/), not personal items. Meta's own glasses can ["remember your spot in long-term parking"](https://about.fb.com/news/2024/09/ray-ban-meta-glasses-new-ai-features-and-partner-integrations/), only when asked to. Project Astra keeps ["up to 10 minutes of in-session memory"](https://blog.google/technology/google-deepmind/google-gemini-ai-update-december-2024/). The AirTag is the competitor that already works, with [precision finding and over a year of battery](https://www.apple.com/airtag/), for any item that can carry a tag and any owner who remembers to attach one.

The nearest evidence on dementia itself is a 2026 JMIR Aging survey of older adults with cognitive impairment. It found [audio reminders ranked highest and "a preference for audio, rather than visual, information exchange"](https://doi.org/10.2196/81840). That supports the voice-first design.

## 5. Recommended pipeline

### For the hackathon

1. Capture as planned. 2 to 5 fps, Laplacian blur filter, newest-frame-wins queue.
2. Detect with YOLOE-26m and text prompts at `imgsz=1280`, on MPS or a cloud GPU. Pre-download the checkpoint and the 254 MB text encoder.
3. At M0, run the bake-off on the recorded walkthrough. YOLOE-26m against the D-FINE Objects365 checkpoint, plus LLMDet tiny if CUDA is available. Hand-count hits on 50 frames per object. Choose the three demo objects from keys, wallet, remote, phone, eyeglasses and mug, by measured recall.
4. Confirm sightings by label voting. Three detections of a label within 2 seconds opens a sighting. No tracker in the MVP.
5. Pick the sharpest confident frame as the keyframe. Send it with the box to the cheapest current vision model with reasoning off. Ask for the README's JSON plus an `itemConfirmed` boolean. Discard or flag sightings the VLM rejects.
6. Set `held` from MediaPipe hand overlap when a hand is visible, and let the VLM's `state` fill in otherwise.
7. If time remains after M3, add one of these. DINOv2 prototype matching for identity, the Gemini recall sweep, or the put-down heuristic. Identity is the best demo of the three.
8. Publish the repo under AGPL-3.0.

Expected API cost is under $0.20 per hour of wear at 60 to 300 keyframes on gpt-5.6-luna or a Gemini Flash-Lite model.

### For a product

1. Replace Ultralytics with a fine-tuned RF-DETR or D-FINE under Apache 2.0. Pretrain or warm-start on EgoObjects, then fine-tune on the item classes. Label with SAM 3 or a VLM on a cloud GPU and review by hand.
2. Run the detector on the phone through Core ML, as the README's stretch goal says. If YOLO26 wins the on-device benchmark, price the Enterprise license against the accuracy gap. Only Ultralytics has published an iPhone number so far.
3. Make identity a first-class step. Per-wearer DINO prototypes from a four-video enrollment, following Find My Things. Evaluate on ORBIT's clutter split before trusting it in a home.
4. Keep the VLM on keyframes for room, surface and verification. Consider an on-device VLM once one with boxes and a usable license has published iPhone latency. Gemma 4 and LFM2.5-VL are the candidates today.
5. Record put-down events as the primary memory, with last sighting as the fallback. HD-EPIC is the dataset to evaluate against.
6. Measure what MemPal measured. Wrong-object rate, wrong-location rate and no-detection rate, per item, with people who have dementia.

## 6. Changes to make to README.md

1. **Goals, the MVP paragraph.** Say the three validated objects come from keys, wallet, remote, phone, eyeglasses and mug, chosen by measured recall at M0. Pill organizer, hearing aid, charger and glasses case have no training data in LVIS or Objects365 and wait for later.
2. **Architecture, the diagram and the pieces table.** Change "YOLOE-26 + tracker" to "detector + label voting". Drop ByteTrack from `services/perception`. Change "open_clip later" to "DINOv2 crop embeddings later".
3. **Perception pipeline, Model.** Keep YOLOE-26 and add its LVIS numbers with Ultralytics' own warning that zero-shot trails a trained model. Note that Objects365 covers keys, wallet, remote and glasses, so "stock weights won't do" is true of COCO only. Add the M0 bake-off against the D-FINE Objects365 checkpoint. Replace the visual-prompt paragraph with DINOv2 prototype matching as the optional identity path.
4. **Perception pipeline, Frame handling.** Change "image size 960 or higher" to `imgsz=1280`, the source width. List SAHI tiling as the next step if recall is poor.
5. **Perception pipeline, From detections to sightings.** Rewrite step 1. Confirm by per-label detections in a time window, with no tracker, since the MVP has one instance per category. Name BoT-SORT with global motion compensation as the later option, and cite the ByteTrack paper on low frame rate and camera motion.
6. **Perception pipeline, Description job.** Add `itemConfirmed` to the JSON and say rejected sightings never reach the item snapshot. Add the hand-overlap source for `held`. State reasoning off and the cost, under $0.20 per hour on gpt-5.6-luna or Gemini Flash-Lite. Cite MemPal's 26-second vision step as the reason this stays asynchronous.
7. **Data model.** Add `referenceEmbeddings` and `embeddingModel` to `items`. Add `verified` to `sightings`.
8. **Where vector search earns its place.** Replace "check the limit" with the fact. A free cluster allows 3 indexes of any type, and automated embedding is text only. Identity vectors stay in memory.
9. **Testing.** Report wrong-object, wrong-location and no-detection rates per item, the three numbers MemPal published, so results are comparable.
10. **Build order, M0 and M6.** Add the detector bake-off and object selection to M0. List identity matching, the recall sweep and put-down detection as the M6 choices, identity first.
11. **Risks.** Rewrite the "Open-vocabulary detection misses small items" row in this order. Supervised-class objects, `imgsz=1280`, medium model, D-FINE Objects365, VLM recall sweep, then fine-tune on auto-labels. Add a licensing row. Point the "Two items share a label" row at DINO matching.
12. **Stretch goals.** On the Core ML line, add that shipping Ultralytics on a phone needs the Enterprise license or a swap to an Apache detector. On put-down detection, name the MediaPipe heuristic and its limits at 2 fps.
13. **Open decisions.** Add the license decision, AGPL-3.0 for the repo or no Ultralytics. On decision 4, note that a CUDA box unlocks LLMDet, Grounding DINO and SAM 3, and a Mac does not.
14. **References.** Add MemPal, ESOM, Find My Things, the Ultralytics license page, D-FINE, RF-DETR and this file.

## 7. What I couldn't verify

Prices and current model names
- Every price came through a fetch tool that summarizes pages. Two independent reads of the OpenAI and Gemini pricing pages agreed. Check the page before budgeting. Third-party blogs list gpt-5.6-sol at $5 and $30, against $4 and $20 on the page as read.
- OpenAI's image-token multipliers differ from older documented values for gpt-5-mini and gpt-5-nano.
- The Gemini 3.8 Live video price row, about $0.12 per hour, was dropped on a first read.
- Prices for Vertex multimodalembedding, Cohere Embed v4, Amazon Titan and Nova embeddings came from aggregators only. I left them out of the body.
- Moondream's tokens per image, so no cost per hour for it. Its 3.1 license file returned 404.
- Whether the Alibaba qwen3.6 and qwen3.7 API models accept images, and whether Qwen3.8 does.
- The SmolVLM2 license, reported as Apache 2.0 and not confirmed on the card.

Speed
- No first-party Apple Silicon MPS numbers exist for YOLOE, YOLO26, RF-DETR, D-FINE or any Grounding DINO variant. The M3 Air figure is a third party's.
- No first-party numbers on consumer NVIDIA cards. Everything published is T4, V100, A100, H100 or H200.
- No iPhone numbers for RF-DETR or D-FINE. Roboflow's "85 FPS" for YOLO11 on Core ML names no device or model size.
- OpenAI publishes no latency. The 5-second figure is Roboflow's, with reasoning on.
- Runtime of the 100DOH detector and HaMeR.
- Whether SAM 3 runs on MPS or CPU at all.

Accuracy
- No small-object AP for any YOLOE model.
- No evaluation of YOLOE visual prompts at instance level.
- DINOv3's retrieval benchmarks are landmarks and artworks. Transfer to household items is my inference.
- SAHI's gains come from aerial datasets.
- Roboflow's GPT-5.6 detection scores are on its own unreleased benchmark. Moondream's scores use its own metric and harness. Meta measured Gemini in the SAM 3 table.
- SAM 3's LVIS mask AP is 48.5 in the repo and 47.0 in the Ultralytics docs.
- I did not run OV-DEIM or any other model. Nothing in this file is our own measurement.

Egocentric literature
- The Ego4D paper's own baseline tables, which exceeded the fetch limit. Baselines here come from the official repo and later papers, and those papers disagree on the SiamRCNN validation row.
- VQ2D challenge winners for 2024 and 2025. The 2026 challenge page lists neither VQ task.
- ESOM's AP columns look inconsistent in units, so I used only its success rates.
- Whether EgoObjects has keys or wallet classes, and which of its two licenses governs.
- The data licenses for ORBIT and HD-EPIC.
- A 62.8% MediaPipe egocentric detection rate and a 0.425 s point-of-no-return error both appeared in search results with no traceable source.
- LifelogQA and GRACE could not be found. Vinci's "90% satisfied" claim has no source. Envision's Find Object page returned 403. Apple's accessibility features were not researched.
- No published "where did I leave X" study includes people with dementia. MemPal's participants had at most mild cognitive impairment.

Licensing
- I read the grant clause of the SAM License and not its full restrictions.
- Whether the `mobileclip2_b.ts` file Ultralytics redistributes carries Apple's research terms. The upstream MobileCLIP2-B card does.
- The Ultralytics Enterprise price.
- None of this is legal advice.

## 8. Sources

Detectors, closed-set
- [Ultralytics YOLO26 docs](https://docs.ultralytics.com/models/yolo26)
- [YOLO26 paper, arXiv 2606.03748](https://arxiv.org/abs/2606.03748)
- [Ultralytics Core ML export docs with iPhone 17 Pro benchmarks](https://docs.ultralytics.com/integrations/coreml)
- [Ultralytics license page](https://www.ultralytics.com/license)
- [RF-DETR repo](https://github.com/roboflow/rf-detr)
- [RF-DETR paper, arXiv 2511.09554](https://arxiv.org/abs/2511.09554)
- [RF-DETR training docs](https://rfdetr.roboflow.com/learn/train/)
- [RF-DETR issue 427, CPU-only inference on Apple Silicon](https://github.com/roboflow/rf-detr/issues/427)
- [D-FINE repo](https://github.com/Peterande/D-FINE)
- [D-FINE Objects365 checkpoint on Hugging Face](https://huggingface.co/ustc-community/dfine-medium-obj365)
- [RT-DETR repo](https://github.com/lyuwenyu/RT-DETR)
- [RT-DETRv4 repo](https://github.com/RT-DETRs/RT-DETRv4)
- [Objects365 class list](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/datasets/Objects365.yaml)
- [LVIS v1 categories with frequency](https://github.com/facebookresearch/detectron2/blob/main/detectron2/data/datasets/lvis_v1_categories.py)
- [YOLO11 on a MacBook Air M3, third-party benchmark](https://yolo.hexdocs.pm/macbook_air_m3.html)
- [Roboflow on iOS detection models](https://blog.roboflow.com/best-ios-object-detection-models/)
- [Autodistill](https://github.com/autodistill/autodistill)

Detectors, open-vocabulary
- [Ultralytics YOLOE docs](https://docs.ultralytics.com/models/yoloe)
- [YOLOE paper, arXiv 2503.07465](https://arxiv.org/abs/2503.07465)
- [THU-MIG/yoloe repo](https://github.com/THU-MIG/yoloe)
- [YOLO-World paper, arXiv 2401.17270](https://arxiv.org/abs/2401.17270)
- [YOLO-World repo](https://github.com/AILab-CVC/YOLO-World)
- [Grounding DINO 1.5 paper, arXiv 2405.10300](https://arxiv.org/abs/2405.10300) and [HTML with Table 5](https://arxiv.org/html/2405.10300v2)
- [DINO-X paper, arXiv 2411.14347](https://arxiv.org/abs/2411.14347)
- [DINO-X API repo](https://github.com/IDEA-Research/DINO-X-API)
- [Grounding DINO repo](https://github.com/IDEA-Research/GroundingDINO)
- [Grounding DINO in transformers](https://huggingface.co/docs/transformers/en/model_doc/grounding-dino)
- [MM Grounding DINO tiny card](https://huggingface.co/openmmlab-community/mm_grounding_dino_tiny_o365v1_goldg_v3det)
- [LLMDet repo](https://github.com/iSEE-Laboratory/LLMDet)
- [OWLv2 paper, arXiv 2306.09683](https://arxiv.org/abs/2306.09683)
- [OWLv2 in transformers](https://huggingface.co/docs/transformers/en/model_doc/owlv2)
- [OWLv2 model card](https://huggingface.co/google/owlv2-base-patch16-ensemble)
- [SAM 3 repo](https://github.com/facebookresearch/sam3)
- [SAM 3 paper, arXiv 2511.16719](https://arxiv.org/abs/2511.16719)
- [Meta's SAM 3 blog post](https://ai.meta.com/blog/segment-anything-model-3/)
- [SAM 3 license](https://github.com/facebookresearch/sam3/blob/main/LICENSE)
- [SA-Co/VEval README with the SmartGlasses split](https://github.com/facebookresearch/sam3/blob/main/scripts/eval/veval/README.md)
- [SAM 3 in Ultralytics](https://docs.ultralytics.com/models/sam-3/)
- [OV-DEIM paper, arXiv 2603.07022](https://arxiv.org/abs/2603.07022) and [repo](https://github.com/wleilei/OV-DEIM)
- [Florence-2 large card](https://huggingface.co/microsoft/Florence-2-large)
- [SAHI paper, arXiv 2202.06934](https://arxiv.org/abs/2202.06934) and [repo](https://github.com/obss/sahi)
- [Roboflow100-VL paper, arXiv 2505.20612](https://arxiv.org/abs/2505.20612)

Tracking
- [ByteTrack paper, section 4.2](https://ar5iv.labs.arxiv.org/html/2110.06864)
- [Ultralytics BoT-SORT config](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/trackers/botsort.yaml)
- [roboflow/supervision](https://github.com/roboflow/supervision)
- [roboflow/trackers](https://github.com/roboflow/trackers)

VLMs and pricing
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI models](https://developers.openai.com/api/docs/models)
- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- [OpenAI images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)
- [Roboflow on GPT-5.6 detection, third party](https://blog.roboflow.com/openai-gpt-5-6/)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini media resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- [Gemini image understanding and box output](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini Live guide](https://ai.google.dev/gemini-api/docs/live-guide) and [session limits](https://ai.google.dev/gemini-api/docs/live-session)
- [Qwen3-VL technical report, arXiv 2511.21631](https://arxiv.org/abs/2511.21631)
- [Qwen3.5-4B card](https://huggingface.co/Qwen/Qwen3.5-4B) and [Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B)
- [Qwen3-VL on Apple Silicon, third-party preprint](https://arxiv.org/html/2601.19139v1)
- [Alibaba Model Studio pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Moondream 3.1 card](https://huggingface.co/moondream/moondream3.1-9B-A2B), [launch post](https://moondream.ai/blog/moondream-3-1-beyond-benchmarks), [Photon benchmarks](https://moondream.ai/blog/photon-1-2-0-update), [pricing](https://moondream.ai/pricing)
- [Moondream 2 card](https://huggingface.co/vikhyatk/moondream2)
- [FastVLM paper](https://arxiv.org/html/2412.13303v2) and [repo](https://github.com/apple/ml-fastvlm)
- [SmolVLM paper, arXiv 2504.05299](https://arxiv.org/abs/2504.05299) and [SmolVLM2 post](https://huggingface.co/blog/smolvlm2)
- [Gemma vision docs](https://ai.google.dev/gemma/docs/capabilities/vision/image)
- [LFM2.5-VL-450M](https://www.liquid.ai/blog/lfm2-5-vl-450m) and [LFM2.5-VL-3B](https://www.liquid.ai/blog/lfm2-5-vl-3b)
- [PaliGemma 2 card](https://huggingface.co/google/paligemma2-3b-mix-448)

Embeddings and identity
- [DINOv3 paper, arXiv 2508.10104](https://arxiv.org/abs/2508.10104) and [HTML with Table 9](https://arxiv.org/html/2508.10104v1)
- [DINOv3 model card](https://github.com/facebookresearch/dinov3/blob/main/MODEL_CARD.md)
- [DINOv3 license](https://ai.meta.com/resources/models-and-libraries/dinov3-license/)
- [DINOv2 repo](https://github.com/facebookresearch/dinov2)
- [SigLIP 2 card](https://huggingface.co/google/siglip2-base-patch16-224)
- [MobileCLIP2-B card](https://huggingface.co/apple/MobileCLIP2-B)
- [InsDet, arXiv 2310.19257](https://arxiv.org/abs/2310.19257)
- [Instance detection from an open-world perspective, arXiv 2503.00359](https://arxiv.org/abs/2503.00359)
- [Voyage pricing](https://docs.voyageai.com/docs/pricing)
- [MongoDB vector index reference](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-type/)
- [MongoDB search limits on free and Flex clusters](https://www.mongodb.com/docs/atlas/atlas-search/limitations/)

Egocentric research
- [Ego4D episodic memory benchmark docs](https://ego4d-data.org/docs/benchmarks/episodic-memory/)
- [Ego4D VQ2D repo README](https://github.com/EGO4D/episodic-memory/blob/main/VQ2D/README.md)
- [ESOM, arXiv 2411.16934](https://arxiv.org/abs/2411.16934) and [HTML](https://arxiv.org/html/2411.16934)
- [CocoFormer, arXiv 2211.10528](https://arxiv.org/abs/2211.10528)
- [VQLoC, arXiv 2306.09324](https://arxiv.org/abs/2306.09324)
- [PRVQL](https://arxiv.org/html/2502.07707v1)
- [HERO-VQL](https://arxiv.org/html/2509.00385)
- [RELOCATE](https://arxiv.org/html/2412.01826v2)
- [EgoHieraLoc](https://arxiv.org/html/2608.09656)
- [EAGLE](https://arxiv.org/html/2511.08007)
- [EgoLoc, arXiv 2212.06969](https://arxiv.org/abs/2212.06969)
- [EgoObjects repo](https://github.com/facebookresearch/EgoObjects) and [paper](https://arxiv.org/abs/2309.08816)
- [ORBIT paper, arXiv 2104.03841](https://arxiv.org/abs/2104.03841) and [repo](https://github.com/microsoft/ORBIT-Dataset)
- [HD-EPIC, arXiv 2502.04144](https://arxiv.org/abs/2502.04144)
- [EPIC-KITCHENS](https://epic-kitchens.github.io/2026) and [VISOR, arXiv 2209.13064](https://arxiv.org/abs/2209.13064)
- [HOI4D](https://hoi4d.github.io/)
- [Ego4D start here](https://ego4d-data.org/docs/start-here/)

Hands and put-down
- [100DOH paper, arXiv 2006.06669](https://arxiv.org/abs/2006.06669) and [repo](https://github.com/ddshan/hand_object_detector)
- [Hands23 detector](https://github.com/EvaCheng-cty/hands23_detector)
- [EgoHOS, arXiv 2208.03826](https://arxiv.org/abs/2208.03826)
- [HaMeR repo](https://github.com/geopavlakos/hamer)
- [WiLoR](https://arxiv.org/html/2409.12259)
- [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker) and [MediaPipe repo](https://github.com/google-ai-edge/mediapipe)
- [Egocentric hand benchmark, arXiv 2409.07337](https://arxiv.org/html/2409.07337v1)
- [MediaPipe under occlusion, arXiv 2603.11383](https://arxiv.org/abs/2603.11383)
- [Ego4D state-change challenge report, arXiv 2211.08728](https://arxiv.org/abs/2211.08728)
- [AMEGO](https://arxiv.org/html/2409.10917v1)
- [Out of Sight, Not Out of Mind](https://arxiv.org/html/2404.05072v1)

Systems
- [MemPal, arXiv 2502.01801](https://arxiv.org/html/2502.01801)
- [Find My Things, CHI EA 2024](https://doi.org/10.1145/3613905.3648641) and [author copy](https://cutrell.org/papers/Wen-CHI2024-Find-My-Things-Demo.pdf)
- [Encode-Store-Retrieve](https://arxiv.org/html/2308.05822v2)
- [EgoLife, arXiv 2503.03803](https://arxiv.org/abs/2503.03803)
- [JMIR Aging 2026 survey](https://doi.org/10.2196/81840)
- [Google Lookout Find mode](https://blog.google/company-news/outreach-and-initiatives/accessibility/ai-accessibility-update-gaad-2024/)
- [Meta on Ray-Ban Meta AI features](https://about.fb.com/news/2024/09/ray-ban-meta-glasses-new-ai-features-and-partner-integrations/)
- [Google on Project Astra](https://blog.google/technology/google-deepmind/google-gemini-ai-update-december-2024/)
- [Apple AirTag](https://www.apple.com/airtag/)
