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
        # Load every exported PNG through Pygame Zero's actual resource loader,
        # including independent animation frames that main.py never instantiates.
        import pgzero.loaders
        for resource in (pathlib.Path(main_file).parent / 'images').glob('*.png'):
            loaded = pgzero.loaders.images.load(resource.stem)
            assert loaded.get_size() == pygame.image.load(resource).get_size()
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
    for kind in ['color', 'image', 'empty', 'shapes']:
        archive = root / f'pygame-runtime-{kind}.zip'
        target = root / f'pygame-runtime-{kind}'
        target.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(target)
        project = target / 'pygame_project'
        main = project / 'main.py'
        tree = ast.parse(main.read_text(encoding='utf-8'))
        rects = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(isinstance(item, ast.Attribute) and item.attr == 'pos' for item in node.targets):
                assert isinstance(node.value, ast.Tuple)
                assert all(isinstance(value, ast.Constant) and type(value.value) is int for value in node.value.elts)
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'Rect':
                values = [ast.literal_eval(arg) for arg in node.value.args]
                assert all(type(value) is int for value in values)
                rects[node.targets[0].id] = pygame.Rect(*values)
        if kind == 'shapes':
            assert rects['wall'] == pygame.Rect(10, 21, 101, 50)
            assert rects['goal'] == pygame.Rect(201, 100, 21, 10)
            assert rects['wall'].collidepoint(20, 30)
            assert not rects['wall'].colliderect(rects['goal'])
        elif kind != 'empty':
            assert rects['wall'] == pygame.Rect(0, 0, 20, 20)
        screenshot = target / 'frame.png'
        subprocess.run([sys.executable, str(pathlib.Path(__file__).resolve()), '--capture', str(main), str(screenshot)], check=True, timeout=15, cwd=project)
        frame = pygame.image.load(screenshot)
        assert frame.get_size() == (320, 240)
        # JPEG background encoding may differ by a channel value.
        assert all(abs(a-b) <= 2 for a, b in zip(frame.get_at((200, 100))[:3], (32, 48, 64)))
        if kind not in ['empty', 'shapes']:
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
            expected = pygame.Surface((320, 240))
            expected.fill('#203040')
            assert pygame.image.tobytes(frame, 'RGB') == pygame.image.tobytes(expected, 'RGB')
        print(f'PASS {kind}: actual Pygame Zero frame -> {screenshot}')

    for kind in ['edits', 'animation']:
        archive = root / f'pygame-runtime-{kind}.zip'
        target = root / f'pygame-runtime-{kind}'
        target.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(target)
        project = target / 'pygame_project'
        main = project / 'main.py'
        source = main.read_text(encoding='utf-8')
        assert 'walk' not in source and 'def update' not in source
        tree = ast.parse(source)
        positions = [node.value for node in ast.walk(tree) if isinstance(node, ast.Assign) and any(isinstance(item, ast.Attribute) and item.attr == 'pos' for item in node.targets)]
        assert len(positions) == 1
        assert all(type(value.value) is int for value in positions[0].elts)
        screenshot = target / 'frame.png'
        subprocess.run([sys.executable, str(pathlib.Path(__file__).resolve()), '--capture', str(main), str(screenshot)], check=True, timeout=15, cwd=project)
        frame = pygame.image.load(screenshot)
        hero = pygame.image.load(project / 'images/hero.png')
        assert frame.get_size() == (320, 240)
        if kind == 'edits':
            assert hero.get_size() == (20, 14)
            assert hero.get_at((1, 1)) == (0, 255, 0, 128)
            assert hero.get_at((18, 12)) == (255, 0, 0, 255)
            assert hero.get_at((1, 12)) == (0, 0, 255, 255)
            assert tuple(value.value for value in positions[0].elts) == (46, 46)
            top_left = (36, 39)
        else:
            assert hero.get_size() == (40, 24)
            top_left = (20, 31)
            for index in range(1, 4):
                image = pygame.image.load(project / f'images/walk_{index:03}.png')
                assert image.get_size() == (43, 25)
            green = pygame.image.load(project / 'images/walk_003.png')
            assert green.get_at((1, 2)) == (0, 255, 0, 255)
            assert green.get_at((40, 21)) == (0, 255, 0, 255)
            assert green.get_at((41, 21)).a == 0
            assert green.get_at((40, 22)).a == 0
        expected = pygame.Surface((320, 240))
        expected.fill('#203040')
        expected.blit(hero, top_left)
        assert pygame.image.tobytes(frame, 'RGB') == pygame.image.tobytes(expected, 'RGB')
        print(f'PASS {kind}: transformed scene and all PNG resources -> {screenshot}')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--capture']:
        capture(sys.argv[2], sys.argv[3])
    else:
        verify()
