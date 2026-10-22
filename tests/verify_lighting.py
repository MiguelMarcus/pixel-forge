"""Pillow verifica mapas RGBA sem quantização nem alteração de alpha."""
from pathlib import Path
from PIL import Image

out = Path(__file__).parent / 'out'
for name in ('rgba-data', 'normal-map', 'bump-map'):
    with Image.open(out / (name + '.png')) as image:
        assert image.mode == 'RGBA', (name, image.mode)
        assert image.size == (17, 17), (name, image.size)
        assert image.tobytes() == (out / (name + '.raw')).read_bytes(), name
        if name == 'rgba-data':
            assert len(image.getcolors(maxcolors=17 * 17)) > 256
    print('ok PNG RGBA:', name)
