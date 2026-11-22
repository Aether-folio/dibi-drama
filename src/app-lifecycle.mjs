// Own resources created by this application, so updates need no iframe navigation.
export function createAppLifecycle(){
 let active=true;
 const timers=new Set(),frames=new Set(),observers=new Set(),original={};
 const replace=(key,value)=>{original[key]=window[key];window[key]=value;};
 const timeout=window.setTimeout.bind(window),interval=window.setInterval.bind(window),clear=window.clearTimeout.bind(window),raf=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
 replace('setTimeout',(fn,delay,...args)=>{const id=timeout(()=>{timers.delete(id);if(active)fn(...args);},delay);timers.add(id);return id;});
 replace('setInterval',(fn,delay,...args)=>{const id=interval(()=>{if(active)fn(...args);},delay);timers.add(id);return id;});
 for(const key of ['clearTimeout','clearInterval'])replace(key,id=>{timers.delete(id);clear(id);});
 replace('requestAnimationFrame',fn=>{const id=raf(time=>{frames.delete(id);if(active)fn(time);});frames.add(id);return id;});
 replace('cancelAnimationFrame',id=>{frames.delete(id);cancel(id);});
 for(const key of ['MutationObserver','ResizeObserver','IntersectionObserver']){const Native=window[key];if(Native)replace(key,new Proxy(Native,{construct(Target,[callback]){const observer=new Target((...args)=>{if(active)callback(...args);});observers.add(observer);return observer;}}));}
 return {get active(){return active;},retire(){active=false;},dispose(){active=false;for(const id of timers)clear(id);for(const id of frames)cancel(id);for(const observer of observers)observer.disconnect();for(const [key,value] of Object.entries(original))window[key]=value;timers.clear();frames.clear();observers.clear();}};
}
