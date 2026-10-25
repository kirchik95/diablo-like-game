import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalCode } from '../src/key-codes.js';

test('a standard code wins over the typed letter', () => {
  assert.equal(physicalCode({ code: 'KeyD', key: 'в' }), 'KeyD');
});

test('Russian letters map back to the physical WASD keys when the code is missing', () => {
  for (const [key, code] of [['ц', 'KeyW'], ['ф', 'KeyA'], ['ы', 'KeyS'], ['в', 'KeyD'], ['В', 'KeyD'], ['у', 'KeyE'], ['й', 'KeyQ'], ['а', 'KeyF']]) {
    assert.equal(physicalCode({ code: '', key }), code, key);
  }
});

test('Latin letters, keyCode and named keys are recovered', () => {
  assert.equal(physicalCode({ code: 'Unidentified', key: 'd' }), 'KeyD');
  assert.equal(physicalCode({ code: '', key: 'Unidentified', keyCode: 68 }), 'KeyD');
  assert.equal(physicalCode({ code: '', key: ' ' }), 'Space');
  assert.equal(physicalCode({ code: '', key: 'ArrowRight' }), 'ArrowRight');
});
