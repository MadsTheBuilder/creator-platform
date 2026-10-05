import { useEffect, useRef, useState } from 'react';
import { SquaresFour, TrendUp, CalendarBlank, FilmStrip, Cube, Scissors, Recycle, Plugs, MagnifyingGlass, List, Plus } from '@phosphor-icons/react';
import { Overview } from './pages/Overview';
import { Connections } from './pages/Connections';
import { Storyboard } from './pages/Storyboard';
// Modules without a route are on the roadmap (see CLAUDE.md) and render as "Soon".
const nav=[
  {label:'Overview',icon:SquaresFour,route:'Overview'},
  {label:'Trends & News',icon:TrendUp},
  {label:'Planner',icon:CalendarBlank},
  {label:'Storyboard',icon:FilmStrip,route:'Storyboard'},
  {label:'3D Previs',icon:Cube},
  {label:'Video Edit',icon:Scissors},
  {label:'Repurpose',icon:Recycle},
  {label:'Connections',icon:Plugs,route:'Connections'},
];
const routes=['Overview','Storyboard','Connections'];
const headings:Record<string,[string,string]>={
  Overview:['Channel performance','Real numbers from the platforms you own. Nothing estimated.'],
  Storyboard:['Script to storyboard','Paste a script and get a shot-by-shot animatic: framing, lens, camera, light and timing for every shot.'],
  Connections:['Connections','Sign in, then connect your channels to track their performance.'],
};
function readRoute(){const hash=window.location.hash.slice(1);return routes.find(r=>r.toLowerCase()===hash)??'Overview';}
export function App(){
  const [route,setRoute]=useState(readRoute),[search,setSearch]=useState(''),[menu,setMenu]=useState(false);
  const searchInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{const change=()=>{setRoute(readRoute());setMenu(false);setSearch('');};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(!menu)return;const trigger=document.querySelector<HTMLButtonElement>('.menu-button');const items=Array.from(document.querySelectorAll<HTMLElement>('.sidebar a,.sidebar button'));items[0]?.focus();function key(event:KeyboardEvent){if(event.key==='Escape'){setMenu(false);return;}if(event.key==='Tab'){const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);trigger?.focus();};},[menu]);
  useEffect(()=>{function key(event:KeyboardEvent){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&searchInput.current){event.preventDefault();searchInput.current.focus();}}document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
  function navigate(next:string){window.location.hash=next.toLowerCase();setRoute(next);setMenu(false);setSearch('');}
  return <div className="app-shell"><a href="#main" className="skip-link" onClick={e=>{e.preventDefault();document.getElementById('main')?.focus();}}>Skip to content</a>{menu&&<button className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMenu(false)}/>}
    <div className="frame">
      <aside className={`sidebar ${menu?'open':''}`}><nav aria-label="Workspace">{nav.map(n=>n.route
        ?<button key={n.label} className={`nav-link ${route===n.route?'active':''}`} onClick={()=>navigate(n.route)} aria-current={route===n.route?'page':undefined} aria-label={n.label}><n.icon size={21} weight={route===n.route?'fill':'regular'}/><span className="dock-tip" aria-hidden>{n.label}</span></button>
        :<button key={n.label} className="nav-link soon" aria-disabled="true" aria-label={`${n.label}, coming soon`}><n.icon size={21}/><span className="dock-tip" aria-hidden>{n.label}<em>Soon</em></span></button>)}</nav></aside>
      <main id="main" className="main" tabIndex={-1} inert={menu}>
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="Toggle navigation" aria-expanded={menu} onClick={()=>setMenu(!menu)}><List size={20}/></button>
          <a href="#overview" className="brand" onClick={e=>{e.preventDefault();navigate('Overview');}}><i aria-hidden/>Content Engine</a>
          <nav className="route-pills" aria-label="Sections">{routes.map(r=><button key={r} className={route===r?'active':''} aria-current={route===r?'page':undefined} onClick={()=>navigate(r)}>{r}</button>)}</nav>
          {route==='Overview'&&<label className="search"><MagnifyingGlass size={16}/><input ref={searchInput} aria-label="Search content" placeholder="Search content" value={search} onChange={e=>setSearch(e.target.value)}/><kbd aria-hidden>Ctrl K</kbd></label>}
          {route==='Overview'&&<button className="button primary topbar-action" onClick={()=>navigate('Connections')}><Plus size={16} weight="bold"/><span>Connect<span className="wide-only"> channel</span></span></button>}
        </header>
        <div className="content">
        <div className="page-heading"><h1>{headings[route][0]}</h1><p>{headings[route][1]}</p></div>
        {route==='Overview'?<Overview search={search} onConnections={()=>navigate('Connections')}/>:route==='Storyboard'?<Storyboard onConnections={()=>navigate('Connections')}/>:<Connections/>}
        </div>
      </main>
    </div>
  </div>;
}
