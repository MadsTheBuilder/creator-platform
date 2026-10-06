import { useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { GoogleAccount } from '../components/GoogleAccount';
import { YouTubeConnection } from '../components/YouTubeConnection';
import { SocialConnection } from '../components/SocialConnection';
import { AssistantConnection } from '../components/AssistantConnection';
const services=[
  {name:'YouTube',purpose:'Owned videos and channel performance'},
  {name:'Instagram',purpose:'Owned content and native engagement'},
  {name:'TikTok',purpose:'Owned video metadata and engagement'},
];
export function Connections() {
  const [selected,setSelected]=useState(()=> { const query = new URLSearchParams(window.location.search); return query.has('tiktok') ? services[2] : query.has('instagram') ? services[1] : services[0]; });
  return <><GoogleAccount/><div className="connection-layout"><section className="glass connection-list" aria-label="Services"><div><h2>Channels</h2>{services.map(s=><button key={s.name} className={selected.name===s.name?'active':''} onClick={()=>setSelected(s)} aria-pressed={selected.name===s.name}><span><strong>{s.name}</strong><small>{s.purpose}</small></span><span className="connection-status">Read-only connector</span><ArrowRight size={18}/></button>)}</div></section>{selected.name === 'YouTube' ? <YouTubeConnection/> : <SocialConnection key={selected.name} provider={selected.name === 'TikTok' ? 'tiktok' : 'instagram'}/>}</div><AssistantConnection/></>;
}
