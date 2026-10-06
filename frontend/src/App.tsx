import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SquaresFour, TrendUp, CalendarBlank, Sparkle, Recycle, Plugs, MagnifyingGlass, List, Plus, ArrowLeft, FileText, FilmStrip, Images, Cube, Scissors, VideoCamera, Compass, Hammer, type Icon } from '@phosphor-icons/react';
import { Overview } from './pages/Overview';
import { Connections } from './pages/Connections';
import { Playground } from './pages/Playground';
import { isStep, stepIn, stepsFor, type Step, type Track } from './data/tracks';
import { Planner } from './pages/Planner';
// Modules without a route are on the roadmap (see CLAUDE.md) and render as "Soon".
const nav=[
  {label:'Overview',icon:SquaresFour,route:'Overview'},
  {label:'Trends & News',icon:TrendUp},
  {label:'Planner',icon:CalendarBlank,route:'Planner'},
  {label:'Playground',icon:Sparkle,route:'Playground'},
  {label:'Repurpose',icon:Recycle},
  {label:'Connections',icon:Plugs,route:'Connections'},
];
const stepIcons:Record<Step,Icon>={script:FileText,shots:FilmStrip,storyboard:Images,'3d':Cube,direct:Compass,build:Hammer,edit:Scissors};
const routes=['Overview','Planner','Playground','Connections'];
const headings:Record<string,[string,string]>={
  Overview:['Channel performance','Real numbers from the platforms you own. Nothing estimated.'],
  Planner:['Content planner','Line up the next few weeks. Drag ideas onto days.'],
  Connections:['Connections','Sign in, then connect your channels to track their performance.'],
};
type Location={route:string;project?:string;step?:Step};
// #overview, #connections, #playground, #playground/<project id>[/<step>] (no step: the track's first)
function readRoute():Location{
  const [head,project,step]=window.location.hash.slice(1).split('/');
  const route=routes.find(r=>r.toLowerCase()===head)??'Overview';
  return {route,project:route==='Playground'&&project?project:undefined,step:isStep(step)?step:undefined};
}
const toHash=(l:Location)=>l.route==='Playground'&&l.project?`playground/${l.project}${l.step?`/${l.step}`:''}`:l.route.toLowerCase();
export function App(){
  const [loc,setLoc]=useState(readRoute),[search,setSearch]=useState(''),[menu,setMenu]=useState(false);
  // The open project's track picks the dock's steps (the Playground reports it once the project loads).
  const [open,setOpen]=useState<{id:string;track:Track}|null>(null);
  const {route}=loc,playground=route==='Playground';
  const track=open&&open.id===loc.project?open.track:null;
  const editing=playground&&!!loc.project&&loc.step==='edit';
  const searchInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{const change=()=>{setLoc(readRoute());setMenu(false);setSearch('');};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(!menu)return;const trigger=document.querySelector<HTMLButtonElement>('.menu-button');const items=Array.from(document.querySelectorAll<HTMLElement>('.sidebar a,.sidebar button'));items[0]?.focus();function key(event:KeyboardEvent){if(event.key==='Escape'){setMenu(false);return;}if(event.key==='Tab'){const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);trigger?.focus();};},[menu]);
  useEffect(()=>{function key(event:KeyboardEvent){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&searchInput.current){event.preventDefault();searchInput.current.focus();}}document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
  function go(next:Location){window.location.hash=toHash(next);setLoc(next);setMenu(false);setSearch('');}
  const navigate=(next:string)=>go({route:next});
  const openProject=(project?:string,step?:Step)=>go({route:'Playground',project,step});
  // Playground swaps the dock for its own: back, then one icon per step of the open project.
  const dock=playground
    ?<nav aria-label="Playground" key="playground">
      <button className="nav-link" style={{'--i':0} as CSSProperties} onClick={()=>loc.project?openProject():navigate('Overview')} aria-label={loc.project?'All projects':'Leave Playground'}><ArrowLeft size={21}/><span className="dock-tip" aria-hidden>{loc.project?'All projects':'Leave Playground'}</span></button>
      {track&&stepsFor(track).map((s,i)=>{const I=stepIcons[s.step],on=stepIn(track,loc.step)===s.step;
        return <button key={s.step} className={`nav-link ${on?'active':''}`} style={{'--i':i+1} as CSSProperties} onClick={()=>openProject(loc.project,s.step)} aria-current={on?'page':undefined} aria-label={s.label}><I size={21} weight={on?'fill':'regular'}/><span className="dock-tip" aria-hidden>{s.label}</span></button>;})}
    </nav>
    :<nav aria-label="Workspace" key="workspace">{nav.map((n,i)=>n.route
      ?<button key={n.label} className={`nav-link ${route===n.route?'active':''}`} style={{'--i':i} as CSSProperties} onClick={()=>navigate(n.route)} aria-current={route===n.route?'page':undefined} aria-label={n.label}><n.icon size={21} weight={route===n.route?'fill':'regular'}/><span className="dock-tip" aria-hidden>{n.label}</span></button>
      :<button key={n.label} className="nav-link soon" style={{'--i':i} as CSSProperties} aria-disabled="true" aria-label={`${n.label}, coming soon`}><n.icon size={21}/><span className="dock-tip" aria-hidden>{n.label}<em>Soon</em></span></button>)}</nav>;
  return <div className="app-shell"><a href="#main" className="skip-link" onClick={e=>{e.preventDefault();document.getElementById('main')?.focus();}}>Skip to content</a>{menu&&<button className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMenu(false)}/>}
    <div className={`frame ${playground?'playground':''} ${editing?'editing':''}`}>
      <aside className={`sidebar ${menu?'open':''} ${playground?'playground':''}`}><span className="sidebar-fill" aria-hidden/>{dock}</aside>
      <main id="main" className="main" tabIndex={-1} inert={menu}>
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="Toggle navigation" aria-expanded={menu} onClick={()=>setMenu(!menu)}><List size={20}/></button>
          <a href="#overview" className="brand" onClick={e=>{e.preventDefault();navigate('Overview');}}><VideoCamera size={18} weight="fill" aria-hidden/>Content Engine</a>
          {route==='Overview'&&<label className="search"><MagnifyingGlass size={16}/><input ref={searchInput} aria-label="Search content" placeholder="Search content" value={search} onChange={e=>setSearch(e.target.value)}/><kbd aria-hidden>Ctrl K</kbd></label>}
          {route==='Overview'&&<button className="button primary topbar-action" onClick={()=>navigate('Connections')}><Plus size={16} weight="bold"/><span>Connect<span className="wide-only"> channel</span></span></button>}
        </header>
        <div className={`content ${editing?'content-editor':''}`}>
        {!playground&&<div className="page-heading"><h1>{headings[route][0]}</h1><p>{headings[route][1]}</p></div>}
        {route==='Overview'?<Overview search={search} onConnections={()=>navigate('Connections')}/>
          :route==='Planner'?<Planner onOpenProject={openProject} onConnections={()=>navigate('Connections')}/>
          :playground?<Playground projectId={loc.project} step={loc.step} onOpen={openProject} onProject={p=>setOpen(p&&{id:p.id,track:p.track})} onConnections={()=>navigate('Connections')}/>
          :<Connections/>}
        </div>
      </main>
    </div>
  </div>;
}
