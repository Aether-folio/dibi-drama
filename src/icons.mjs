const paths={pen:'M16 3c2-2 4-1 3 2-1 4-5 8-9 10l-5 1 1-5C8 7 12 4 16 3ZM5 16l-2 5m4-8 4 3',check:'m5 12 4 4L19 6',close:'m6 6 12 12M18 6 6 18',again:'M4 10a8 8 0 1 1 1 8M4 4v6h6',compare:'M4 4h16v16H4zM12 4v16',bookmark:'M6 3h12v18l-6-4-6 4z',send:'m3 3 18 9-18 9 4-9-4-9Zm4 9h14',note:'M4 4h16v12H9l-5 4V4Zm4 4h8m-8 4h5',history:'M4 5v5h5M4 10a8 8 0 1 1 1 7m7-10v5l3 2',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',archive:'M4 8h16v12H4zM3 4h18v4H3zM9 12h6',undo:'m9 5-6 5 6 5M3 10h10c5 0 7 3 7 7',save:'M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8',copy:'M8 8h13v13H8zM3 16V3h13',expand:'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6',collapse:'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6',plus:'M12 4v16M4 12h16',settings:'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',pause:'M9 5v14M15 5v14',stop:'M7 7h10v10H7z',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',shelf:'M4 3h5v18H4zM10 6h4v15h-4zM15 4l4-1 3 17-4 1z'};
Object.assign(paths,{
  board:'M3 5h18v13H3zM8 22l2-4m4 0 2 4M6 14l3-3 3 2 4-5m0 0v3m0-3h3',
  pencil:'m4 16-1 5 5-1L20 8l-4-4L4 16Zm9-9 4 4M4 16l4 4',
  marker:'m7 14 7-10a2 2 0 0 1 3-.4l3 2a2 2 0 0 1 .4 3L13 18l-6-4Zm0 0-2 3 4 3 4-2M3 21h7',
  eraser:'m3 13 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H8l-5-4a2 2 0 0 1 0-3Zm5-5 9 8m-5 4h9',
  lasso:'M6 15C0 12 4 4 12 4c6 0 9 3 9 6 0 4-4 6-9 6-4 0-6-3-5-5 1-2 4-1 4 1 0 3-6 3-6 7 0 1 1 2 3 2',
  type:'M4 7V4h16v3M12 4v16m-4 0h8',
  hand:'M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-2c-2 0-4-1-5-3l-3-4a1.6 1.6 0 0 1 2-2.4L8 13Z',
  redo:'m15 5 6 5-6 5m6-5H11c-5 0-7 3-7 7',minus:'M5 12h14',
  locate:'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5m8-6a3 3 0 1 1 0 6 3 3 0 1 1 0-6Z',
  palette:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.7 1.7 0 0 1 1.3-2.8H18a3 3 0 0 0 3-3c0-5-4-9-9-9ZM7 10h.1m4-3h.1m5 2h.1',
});
export function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.innerHTML=`<path d="${paths[name]||paths.note}"/>`;return svg;}
export function iconButton(label,name,action){const button=document.createElement('button');button.type='button';button.className='ghost-icon';button.title=label;button.setAttribute('aria-label',label);button.append(icon(name));if(action)button.addEventListener('click',action);return button;}
export function decorateButton(button,label,name){button.classList.add('ghost-icon');button.title=label;button.setAttribute('aria-label',label);button.replaceChildren(icon(name));}
