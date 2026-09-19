from vision_service.adapters.openai_vlm import image_media_type


def test_image_media_type_sniffs_supported_formats():
    assert image_media_type(b"\x89PNG\r\n") == "image/png"
    assert image_media_type(b"\xff\xd8\xff") == "image/jpeg"
    assert image_media_type(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"
    assert image_media_type(b"unknown") == "image/jpeg"
