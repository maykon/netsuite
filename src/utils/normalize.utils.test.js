import { describe, it } from 'node:test';
import { strictEqual, match } from 'node:assert';
import NormalizeUtils from './normalize.utils.js';

describe('Normalize Unit Tests', () => {
  it('I should normalize the test removing all the invalid chars', () => {
    strictEqual(1, 1);
    strictEqual(NormalizeUtils.normalize('~test'), 'test');
    strictEqual(NormalizeUtils.normalize('.test'), 'test');
    strictEqual(NormalizeUtils.normalize('test.'), 'test');
    strictEqual(NormalizeUtils.normalize('te...st'), 'te.st');
    strictEqual(NormalizeUtils.normalize('~Tilde'), 'Tilde');
    strictEqual(NormalizeUtils.normalize('Number sign (#)'), 'Number sign (#)');
    strictEqual(NormalizeUtils.normalize('Percent (%)'), 'Percent ()');
    strictEqual(NormalizeUtils.normalize('Ampersand (&)'), 'Ampersand (and)');
    strictEqual(NormalizeUtils.normalize('Asterisk (*)'), 'Asterisk ()');
    strictEqual(NormalizeUtils.normalize('Braces ({ })'), 'Braces ( )');
    strictEqual(NormalizeUtils.normalize('Backslash (\)'), 'Backslash ()');
    strictEqual(NormalizeUtils.normalize('Colon (:)'), 'Colon ()');
    strictEqual(NormalizeUtils.normalize('Angle brackets (< >)'), 'Angle brackets ( )');
    strictEqual(NormalizeUtils.normalize('Question mark (?)'), 'Question mark ()');
    strictEqual(NormalizeUtils.normalize('Slash (/)'), 'Slash ()');
    strictEqual(NormalizeUtils.normalize('Plus sign (+)'), 'Plus sign ()');
    strictEqual(NormalizeUtils.normalize('Plus sign (+)'), 'Plus sign ()');
    strictEqual(NormalizeUtils.normalize('Pipe (|)'), 'Pipe ()');
    strictEqual(NormalizeUtils.normalize('Quotation mark (")'), 'Quotation mark ()');
  });

  it('Should remove links in the text', () => {
    strictEqual(NormalizeUtils.normalize('Manteca  https://data-manteca.opendata.arcgis.com/datasets/437728d82d744e9b91d0c2202ef545dc_28/explore?location=37.812660%2C-121.260275%2C18.95'), 'Manteca');
    strictEqual(NormalizeUtils.normalize('Google http://google.com.br WebSite'), 'Google WebSite');
  });

});