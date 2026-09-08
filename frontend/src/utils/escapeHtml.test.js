import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml.js';

describe('escapeHtml', () => {
  it('轉義 &', () => expect(escapeHtml('a&b')).toBe('a&amp;b'));
  it('轉義 <', () => expect(escapeHtml('<script>')).toBe('&lt;script&gt;'));
  it('轉義 >', () => expect(escapeHtml('x>y')).toBe('x&gt;y'));
  it('轉義 "', () => expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;'));
  it("轉義 '", () => expect(escapeHtml("it's")).toBe('it&#039;s'));
  it('安全字串不變', () => expect(escapeHtml('hello world 123')).toBe('hello world 123'));
  it('數字轉成字串後回傳（樣板字串插值結果不變）', () => expect(escapeHtml(42)).toBe('42'));
  it('null/undefined 原樣回傳', () => {
    expect(escapeHtml(null)).toBe(null);
    expect(escapeHtml(undefined)).toBe(undefined);
  });
  it('陣列型別會被字串化後轉義，不能繞過跳脫（曾經是真實可利用的漏洞）', () => {
    const result = escapeHtml(['<img src=x onerror=alert(1)>']);
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });
  it('物件型別會被字串化後轉義，不會原樣輸出', () => {
    const result = escapeHtml({ toString: () => '<script>alert(1)</script>' });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});
