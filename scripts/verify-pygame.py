"""Run browser-exported projects in the real Pygame Zero loop, capture and check a frame.

Run after npm run test:e2e: python scripts/verify-pygame.py
Uses the SDL dummy driver so no classroom/desktop windows are opened.
"""
import os
import ast
import pathlib
import subprocess
import sys
import zipfile


def capture(main_file, output):
    os.environ['SDL_VIDEODRIVER'] = 'dummy'
    os.environ['SDL_AUDIODRIVER'] = 'dummy'
    import pygame
    import runpy

    original_flip = pygame.display.flip

    def flip():
        original_flip()
        pygame.image.save(pygame.display.get_surface(), output)
        pygame.event.post(pygame.event.Event(pygame.QUIT))

    pygame.display.flip = flip
    sys.argv = [main_file]
    runpy.run_path(main_file, run_name='__main__')


def verify():
    os.environ['SDL_VIDEODRIVER'] = 'dummy'
    os.environ['SDL_AUDIODRIVER'] = 'dummy'
    import pygame

    root = pathlib.Path(__file__).resolve().parent.parent / 'test-results'
    for kind in ['color', 'image', 'empty']:
        archive = root / f'pygame-runtime-{kind}.zip'
        target = root / f'pygame-runtime-{kind}'
        target.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(target)
        project = target / 'pygame_project'
        main = project / 'main.py'
        for node in ast.walk(ast.parse(main.read_text(encoding='utf-8'))):
            if isinstance(node, ast.Assign) and any(isinstance(item, ast.Attribute) and item.attr == 'pos' for item in node.targets):
                assert isinstance(node.value, ast.Tuple)
                assert all(isinstance(value, ast.Constant) and type(value.value) is int for value in node.value.elts)
        screenshot = target / 'frame.png'
        subprocess.run([sys.executable, str(pathlib.Path(__file__).resolve()), '--capture', str(main), str(screenshot)], check=True, timeout=15, cwd=project)
        frame = pygame.image.load(screenshot)
        assert frame.get_size() == (320, 240)
        # JPEG background encoding may differ by a channel value.
        assert all(abs(a-b) <= 2 for a, b in zip(frame.get_at((200, 100))[:3], (32, 48, 64)))
        if kind != 'empty':
            cat = pygame.image.load(project / 'images/cat.png')
            dog = pygame.image.load(project / 'images/dog.png')
            assert cat.get_size() == (81, 40)
            assert dog.get_size() == (40, 20)
            assert cat.get_at((40, 20)).a == 128
            assert cat.get_at((78, 20)).a == 0
            assert frame.get_at((30, 40)).r > 245  # red cat in expected position
            assert frame.get_at((65, 55)).g > 245  # dog drawn above cat
            # Check the entire frame against separately composed image assets.
            pygame.init()
            expected = pygame.Surface((320, 240))
            if kind == 'image':
                expected.blit(pygame.image.load(project / 'images/background.png'), (0, 0))
            else:
                expected.fill('#203040')
            expected.blit(cat, (20, 31))
            expected.blit(dog, (60, 50))
            # Odd image widths can give half-pixel edges even with integer centers.
            for point in [(30, 40), (50, 40), (65, 55), (95, 55), (200, 100)]:
                assert frame.get_at(point) == expected.get_at(point), (kind, point, frame.get_at(point), expected.get_at(point))
        else:
            assert list((project / 'images').iterdir()) == []
        print(f'PASS {kind}: actual Pygame Zero frame -> {screenshot}')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--capture']:
        capture(sys.argv[2], sys.argv[3])
    else:
        verify()
