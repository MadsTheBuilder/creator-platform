import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { useState } from 'react';
import { Info, type Icon } from '@phosphor-icons/react';
export function Button({children,className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`button ${className}`} {...props}>{children}</button>;}
export function Empty({title,body,children}:{title:string;body:string;children?:ReactNode}){return <div className="empty"><Info size={32}/><h2>{title}</h2><p>{body}</p>{children}</div>;}
export function Notice({children}:{children:ReactNode}){return <div className="notice"><Info size={18} aria-hidden/>{children}</div>;}
// Provider CDN thumbnail; falls back to the platform icon when missing or expired.
export function Thumb({src,alt,icon:Fallback,size,className=''}:{src?:string|null;alt:string;icon:Icon;size:number;className?:string}){const [failed,setFailed]=useState<string|null>(null);return src&&failed!==src?<img className={`ig-thumb ${className}`} src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>:<span className={`ig-thumb ig-thumb-empty ${className}`}><Fallback size={size}/></span>;}
