import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { CopyButton } from './ui';

const CLAUDE_INSTALL = `/plugin marketplace add MadsTheBuilder/creator-platform
/plugin install creator-platform@creator-platform`;
const CODEX_INSTALL = `codex plugin marketplace add https://github.com/MadsTheBuilder/creator-platform
codex plugin add creator-platform@creator-platform`;
const prompt = (links: string) => `Use the creator-profile skill to build a style profile for this creator: ${links.trim() || '<paste the channel link, or the reel/video links>'}
When it passes, save it to my Content Engine account and tell me when it shows up under Style.`;
const SAVE_PROMPT = 'Add my creator profile in style-library/<folder> to Content Engine.';

// How to make a style with the creator's own Claude Code or Codex: install the plugin once (it carries the
// creator-profile skill and the Content Engine connection), then send the prompt with the creator's links.
export function NewStyleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [links, setLinks] = useState('');
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); else if (!open && d.open) d.close(); }, [open]);
  const text = prompt(links);
  return <dialog ref={ref} className="glass project-dialog new-style-dialog" aria-label="Create a new style" onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="section-toolbar"><h2>Create a new style</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18}/></button></div>
    <p className="muted">Your own Claude Code or Codex studies the creator's videos on your computer and saves the style here. The videos never leave your computer.</p>
    <h3>1. Install the Creator Platform plugin once</h3>
    <p className="muted">It adds the creator-profile skill and connects to your account. Skip this if you already have it.</p>
    <code className="copy-block">{CLAUDE_INSTALL}</code><CopyButton text={CLAUDE_INSTALL} label="Copy Claude Code commands"/>
    <code className="copy-block">{CODEX_INSTALL}</code><CopyButton text={CODEX_INSTALL} label="Copy Codex commands"/>
    <h3>2. Add the creator's channel</h3>
    <label>Channel link, or reel and video links<textarea rows={2} value={links} onChange={e => setLinks(e.target.value)} placeholder="https://www.youtube.com/@creator"/></label>
    <h3>3. Send this prompt</h3>
    <code className="copy-block">{text}</code><CopyButton text={text} label="Copy prompt"/>
    <p className="muted">It takes a while (downloads, transcripts, seven researchers). When it's done the style shows up on this page.</p>
    <h3>Already made a profile?</h3>
    <p className="muted">If you made one with the creator-profile skill before, ask Claude to save it here:</p>
    <code className="copy-block">{SAVE_PROMPT}</code><CopyButton text={SAVE_PROMPT} label="Copy"/>
  </dialog>;
}
