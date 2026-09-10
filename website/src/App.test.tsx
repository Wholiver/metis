import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { INSTALL_COMMAND, LINKS } from './content';

const setMotionPreference = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
};

describe('Metis website', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
    setMotionPreference(false);
  });

  it('renders the clean single-screen hero portal with headline and living black cloud', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Make any model a better coder.' })).toBeInTheDocument();
    expect(screen.getAllByText('82.02% Metis').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'Metis cloud coding agent' })).toBeInTheDocument();
  });

  it('switches language, metadata, and persisted preference', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '切换为中文' }));
    expect(screen.getByRole('heading', { name: '让任何模型更会写代码。' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('Metis | 让任何模型更会写代码');
    expect(localStorage.getItem('metis-site-locale')).toBe('zh-CN');
  });

  it('copies the CLI install command and makes the cloud smile', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<App />);
    const cloud = screen.getByRole('img', { name: 'Metis cloud coding agent' });
    await user.click(screen.getByRole('button', { name: 'Copy install command' }));
    expect(writeText).toHaveBeenCalledWith(INSTALL_COMMAND);
    expect(screen.getByText('Copied')).toBeInTheDocument();
    expect(cloud).toHaveAttribute('data-cloud-expression', 'happy');
  });

  it('uses canonical external destinations without duplicate download buttons', () => {
    render(<App />);
    expect(screen.getByRole('link', { name: /Download Metis/ })).toHaveAttribute('href', LINKS.releases);
    expect(screen.getAllByRole('link', { name: 'GitHub' })[0]).toHaveAttribute('href', LINKS.repository);
    expect(screen.getByRole('link', { name: 'Read benchmark details' })).toHaveAttribute('href', LINKS.benchmark);
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', LINKS.docs);
    expect(screen.getByRole('link', { name: 'npm' })).toHaveAttribute('href', LINKS.npm);
  });

  it('keeps the same living black cloud SVG while expression changes on interaction', () => {
    render(<App />);
    const cloud = screen.getByRole('img', { name: 'Metis cloud coding agent' });
    const container = cloud.closest('.story-main-cloud');
    expect(cloud.tagName).toBe('svg');
    expect(cloud.querySelector('.cloud-body-path')).toHaveAttribute('fill', '#09090b');
    fireEvent.pointerEnter(container!);
    expect(cloud).toHaveAttribute('data-cloud-expression', 'happy');
    fireEvent.pointerLeave(container!);
    expect(cloud).toHaveAttribute('data-cloud-expression', 'idle');
  });

  it('uses a static neutral main cloud for reduced motion', () => {
    setMotionPreference(true);
    render(<App />);
    expect(screen.getByRole('img', { name: 'Metis cloud coding agent' })).toHaveAttribute('data-cloud-expression', 'neutral');
  });

  it('does not use raster product imagery', () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll('img[src$=".png"], img[src$=".jpg"], img[src$=".webp"]')).toHaveLength(0);
  });
});
