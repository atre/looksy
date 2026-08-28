import { describe, it, expect } from 'vitest';
import { classifyLink } from '../../src/links.js';

describe('classifyLink', () => {
  it('bot-blocker status 999 on LinkedIn is unverifiable', () => {
    expect(classifyLink(999, 'www.linkedin.com', [])).toBe('unverifiable');
  });

  it('403 on any host is unverifiable', () => {
    expect(classifyLink(403, 'example.com', [])).toBe('unverifiable');
  });

  it('429 on any host is unverifiable', () => {
    expect(classifyLink(429, 'example.com', [])).toBe('unverifiable');
  });

  it('404 is broken', () => {
    expect(classifyLink(404, 'example.com', [])).toBe('broken');
  });

  it('500 on an allow-listed host is unverifiable, not broken', () => {
    expect(classifyLink(500, 'x.example', ['x.example'])).toBe('unverifiable');
  });

  it('200 is ok', () => {
    expect(classifyLink(200, 'example.com', [])).toBe('ok');
  });

  it('null status (network error) is broken', () => {
    expect(classifyLink(null, 'example.com', [])).toBe('broken');
  });

  it('null status on a bot-blocked host is unverifiable', () => {
    expect(classifyLink(null, 'linkedin.com', [])).toBe('unverifiable');
  });

  it('bare bot-blocked domain (no subdomain) is unverifiable', () => {
    expect(classifyLink(200, 'twitter.com', [])).toBe('unverifiable');
    expect(classifyLink(200, 'x.com', [])).toBe('unverifiable');
    expect(classifyLink(200, 'instagram.com', [])).toBe('unverifiable');
    expect(classifyLink(200, 'facebook.com', [])).toBe('unverifiable');
  });

  it('unrelated host with similar suffix is not matched', () => {
    expect(classifyLink(404, 'notlinkedin.com', [])).toBe('broken');
  });

  it('allow-listed subdomain matches via suffix', () => {
    expect(classifyLink(404, 'sub.x.example', ['x.example'])).toBe('unverifiable');
  });
});
