import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { useEffect, useRef, useState } from 'react';
import { CaretDown, Info, X, type Icon } from '@phosphor-icons/react';
import { TRACKS, type Track } from '../data/tracks';
export function Button({children,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`button ${className}`} {...props}>{children}</button>;}
export function Empty({title,body,children}:{title:string;body:string;children?:ReactNode}){return <div className="empty"><Info size={32}/><h2>{title}</h2><p>{body}</p>{children}</div>;}
export function Notice({children}:{children:ReactNode}){return <div className="notice"><Info size={18} aria-hidden/>{children}</div>;}
// Provider CDN thumbnail; falls back to the platform icon when missing or expired.
export function Thumb({src,alt,icon:Fallback,size,className=''}:{src?:string|null;alt:string;icon:Icon;size:number;className?:string}){const [failed,setFailed]=useState<string|null>(null);return src&&failed!==src?<img className={`ig-thumb ${className}`} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>:<span className={`ig-thumb ig-thumb-empty ${className}`}><Fallback size={size}/></span>;}
// Production is orange, Studio is the Playground blue, so the two kinds of project read apart at a glance.
export function TrackBadge({track}:{track:Track}){return <span className={`track-badge track-${track}`}>{TRACKS[track].label}</span>;}
// Show/hide toggle for a section body. Keep the body mounted (use `hidden`) so unsaved input survives a collapse.
export function Collapser({open,onToggle,label}:{open:boolean;onToggle:()=>void;label:string}){return <button type="button" className="button collapser" aria-expanded={open} onClick={onToggle}><CaretDown size={16} aria-hidden/>{open?`Hide ${label}`:`Show ${label}`}</button>;}
// Full-size view of one image in a native modal. Esc, the X or a click outside closes it.
export function Lightbox({image,onClose}:{image:{src:string;alt:string}|null;onClose:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const d=ref.current;if(!d)return;if(image&&!d.open)d.showModal();else if(!image&&d.open)d.close();},[image]);return <dialog ref={ref} className="lightbox" aria-label={image?.alt||'Image'} onClose={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>{image&&<><img src={image.src} alt={image.alt}/><button type="button" className="lightbox-close" aria-label="Close" onClick={onClose}><X size={18}/></button></>}</dialog>;}
