import * as assert from 'assert';
import { supportsSecondarySidebar } from '../../views/currentStep/currentStepView';

suite('current step: placement', () => {
  test('goes to the secondary side bar from VS Code 1.106', () => {
    assert.strictEqual(supportsSecondarySidebar('1.106.0'), true);
    assert.strictEqual(supportsSecondarySidebar('1.141.2'), true);
    assert.strictEqual(supportsSecondarySidebar('2.0.0'), true);
  });

  test('falls back below Tours on older versions', () => {
    assert.strictEqual(supportsSecondarySidebar('1.105.9'), false);
    assert.strictEqual(supportsSecondarySidebar('1.90.0'), false);
  });
});
