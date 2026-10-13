// ALGO/ART — experimental procedural oil-material engine, version OIL-3.
// A material treatment of existing geometry, never a new composition mode.
// No trained models, photo filters, services or external assets are used.
// The original OIL-1 experiment is frozen in experiments/torn-paper-v1.js.
window.AlgoArt=window.AlgoArt||{};
(function(A){
'use strict';

var PHI=1.61803398875;
var COLOR={
  canvas:'#f2ebdd',
  ground:['#f5eee2','#ede5d7','#e4dfd3','#f9f2e7','#e9e3d7'],
  pale:['#fcf5e9','#f6eddf','#ede3d2','#dddacd','#ead8bf','#f1e9dc'],
  mid:['#b8c1b8','#abbab7','#a0b2ae','#b6b8a9','#c3bca9','#b6b0a0'],
  green:['#778b82','#879288','#626f61','#9ca08b'],
  deep:['#273f3e','#3b4c49','#4a5751','#605f51','#4e4740'],
  warm:['#ad683c','#c58146','#cb9b56','#bd8748','#926344'],
  glaze:['#b5b2a4','#bdc2b6','#e0c3a2','#c1ab91']
};
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function pick(r,a){return a[Math.min(a.length-1,Math.floor(r.n()*a.length))]}
function p(a,b,t){return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function near(a,b,d){return dist(a,b)<=d}
function tang(a,b){return Math.atan2(b.y-a.y,b.x-a.x)}
function move(o,theta,d){return{x:o.x+Math.cos(theta)*d,y:o.y+Math.sin(theta)*d}}
function inVoid(x,y,voids){
  for(var i=0;i<voids.length;i++){
    var v=voids[i];
    if(x>=v.x&&x<=v.x+v.w&&y>=v.y&&y<=v.y+v.h)return true;
  }
  return false;
}
function parsePath(src){
  var t=(src.d||'').match(/[MLC]|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi)||[];
  var pts=[],q=null,i=0,cmd='';
  function n(){return Number(t[i++])}
  while(i<t.length&&pts.length<640){
    if(/^[MLC]$/.test(t[i])){cmd=t[i++];continue}
    if(cmd==='M'||cmd==='L'){
      if(i+1>=t.length)break;
      q={x:n(),y:n()};pts.push(q);cmd='L';
    }else if(cmd==='C'&&q){
      if(i+5>=t.length)break;
      var a={x:n(),y:n()},b={x:n(),y:n()},c={x:n(),y:n()},from=q;
      for(var s=1;s<=8;s++){
        var u=s/8,v=1-u;
        pts.push({x:v*v*v*from.x+3*v*v*u*a.x+3*v*u*u*b.x+u*u*u*c.x,
          y:v*v*v*from.y+3*v*v*u*a.y+3*v*u*u*b.y+u*u*u*c.y});
      }
      q=c;cmd='L';
    }else break;
  }
  // Older landscape Growth Systems use an SVG-space transform.
  if(src.transform){
    var m=(src.transform.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)||[]).map(Number);
    if(m.length===6)pts=pts.map(function(o){
      return{x:m[0]*o.x+m[2]*o.y+m[4],y:m[1]*o.x+m[3]*o.y+m[5]};
    });
  }
  return pts;
}
function skeleton(paths,limit){
  // Repeated marker passes and near-identical colours must not create
  // duplicate painted walls. Round chain bounds, then retain first encounter.
  var seen={},chains=[];
  for(var i=0;i<paths.length;i++){
    var pts=parsePath(paths[i]);
    if(pts.length<2)continue;
    var length=0;
    for(var j=1;j<pts.length;j++)length+=dist(pts[j-1],pts[j]);
    if(length<9)continue;
    var fst=pts[0],lst=pts[pts.length-1];
    var key=[Math.round(fst.x/10),Math.round(fst.y/10),
      Math.round(lst.x/10),Math.round(lst.y/10),Math.round(length/25)].join(':');
    if(seen[key])continue;seen[key]=true;
    var simplified=[pts[0]],prev=pts[0];
    for(j=1;j<pts.length;j++){
      if(dist(pts[j],prev)>=26||j===pts.length-1){
        simplified.push(pts[j]);prev=pts[j];
      }
    }
    if(simplified.length>=2)chains.push({pts:simplified,length:length,width:paths[i].width||4});
  }
  chains.sort(function(a,b){return b.length-a.length});
  if(chains.length>limit){
    // Preserve many short supporting marks while privileging long structures.
    var leading=chains.slice(0,Math.floor(limit*.62));
    var rest=chains.slice(Math.floor(limit*.62));
    var step=Math.max(1,Math.ceil(rest.length/(limit-leading.length)));
    for(var k=0;k<rest.length&&leading.length<limit;k+=step)leading.push(rest[k]);
    chains=leading;
  }
  return chains;
}
function brush(ctx,a,b,w,col,alpha,r,bristles){
  var l=dist(a,b);if(l<1)return;
  var theta=tang(a,b);
  var mid=move(p(a,b,.5),theta+Math.PI/2,r.range(-w*.18,w*.18));
  ctx.save();
  ctx.globalAlpha=clamp(alpha,0,1);ctx.strokeStyle=col;
  ctx.lineCap=w>6?'butt':'round';ctx.lineJoin='round';ctx.lineWidth=Math.max(.65,w);
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(mid.x,mid.y,b.x,b.y);ctx.stroke();
  if(bristles){
    // Relief is directional, rather than indiscriminate pixel noise.
    var normal=theta+Math.PI/2;
    var strips=Math.max(2,Math.min(13,Math.round(w/6)));
    for(var i=0;i<strips;i++){
      var offset=(i/(strips-1)-.5)*w*.82;
      if(r.chance(.18))continue;
      var ba=move(p(a,b,r.range(.03,.25)),normal,offset);
      var bb=move(p(a,b,r.range(.73,.98)),normal,offset);
      var bm=move(mid,normal,offset+r.range(-1.5,1.5));
      ctx.globalAlpha=alpha*r.range(.10,.36);
      ctx.strokeStyle=i%3===0?'#fff5e4':(i%3===1?'#3b463e':'#d0bb9b');
      ctx.lineWidth=r.range(.5,2.2);
      ctx.beginPath();ctx.moveTo(ba.x,ba.y);ctx.quadraticCurveTo(bm.x,bm.y,bb.x,bb.y);ctx.stroke();
    }
  }
  ctx.restore();
}
function irregularPatch(ctx,c,rx,ry,angle,col,alpha,r){
  ctx.save();
  ctx.translate(c.x,c.y);ctx.rotate(angle);
  ctx.beginPath();
  var points=[],n=13;
  for(var j=0;j<n;j++){
    var rad=j*2*Math.PI/n,scale=r.range(.82,1.17);
    points.push({x:Math.cos(rad)*rx*scale,y:Math.sin(rad)*ry*scale});
  }
  var mid=p(points[n-1],points[0],.5);
  ctx.moveTo(mid.x,mid.y);
  for(j=0;j<n;j++){
    var a=points[j],b=points[(j+1)%n],m=p(a,b,.5);
    ctx.quadraticCurveTo(a.x,a.y,m.x,m.y);
  }
  ctx.closePath();ctx.globalAlpha=alpha;ctx.fillStyle=col;ctx.fill();
  ctx.restore();
}
function paintGround(ctx,w,h,chains,r,level){
  // The pigmented raster already forms a continuous ground; these are glazes.
  // Interlocking underpainting fields are muted and continuous.
  for(var i=0;i<Math.round(27*level);i++){
    var c={x:r.range(-w*.1,w*1.1),y:r.range(-h*.1,h*1.1)};
    var size=r.range(95,380);
    irregularPatch(ctx,c,size,size*r.range(.5,1.5),
      r.range(-Math.PI,Math.PI),pick(r,COLOR.ground),r.range(.10,.29),r);
  }
  // Broad dry-wet directional scumbles visible through subsequent paint.
  for(i=0;i<Math.round(68*level);i++){
    var anchor=chains.length?pick(r,chains):null;
    var q=anchor?pick(r,anchor.pts):{x:r.range(0,w),y:r.range(0,h)};
    var at=move(q,r.range(0,Math.PI*2),r.range(0,190));
    var theta=r.range(-.9,.9),len=r.range(70,350);
    brush(ctx,at,move(at,theta,len),r.range(30,130),
      pick(r,COLOR.ground),r.range(.04,.14),r,false);
  }
}
function toneFor(r,index){
  var n=index%11;
  if(n<4)return pick(r,COLOR.mid);
  if(n<7)return pick(r,COLOR.ground);
  if(n<9)return pick(r,COLOR.green);
  if(n===9)return pick(r,COLOR.warm);
  return pick(r,COLOR.pale);
}
function sweepRegion(ctx,points,half,col,r,alpha){
  // Connected paint masses built from the complete chain, not independent
  // rectangular dabs. Smooth joins remove the previous torn-paper effect.
  var n=points.length;if(n<2)return;
  var left=[],right=[],waves=[],i;
  for(i=0;i<n;i++){
    var before=points[Math.max(0,i-1)],after=points[Math.min(n-1,i+1)];
    var dir=tang(before,after),normal=dir+Math.PI/2;
    var swell=.85+Math.sin(i*1.25+half)*.12+r.range(-.07,.07);
    var width=half*swell;
    waves.push({dir:dir,width:width});
    left.push(move(points[i],normal,width));
    right.push(move(points[i],normal,-width*.82));
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0].x,left[0].y);
  for(i=1;i<left.length;i++){
    var lm=p(left[i-1],left[i],.5);
    ctx.quadraticCurveTo(lm.x,lm.y,left[i].x,left[i].y);
  }
  for(i=n-1;i>=0;i--){
    if(i<n-1){
      var rm=p(right[i+1],right[i],.5);
      ctx.quadraticCurveTo(rm.x,rm.y,right[i].x,right[i].y);
    }else ctx.lineTo(right[i].x,right[i].y);
  }
  ctx.closePath();ctx.globalAlpha=alpha;
  ctx.fillStyle=col;ctx.fill();
  // Broad body texture is CLIPPED to the same mass so it reads as paint
  // deposited over a continuous surface, not loose scraps.
  ctx.clip();
  var strokes=Math.min(38,Math.max(8,Math.floor(n*2.4)));
  for(i=0;i<strokes;i++){
    var ix=r.int(0,n-2),a=points[ix],b=points[ix+1];
    var length=dist(a,b),theta=tang(a,b),normal=theta+Math.PI/2;
    var offset=r.range(-half,half)*.77;
    var centre=move(p(a,b,r.range(.15,.85)),normal,offset);
    var start=move(centre,theta+Math.PI,r.range(12,62));
    var end=move(centre,theta,r.range(25,110));
    var pigments=i%6===0?COLOR.deep:(i%4===0?COLOR.pale:COLOR.glaze);
    brush(ctx,start,end,r.range(3,half*.32),
      pick(r,pigments),r.range(.08,.32),r,i%3===0);
  }
  ctx.restore();
  // Ragged margins and partial repaint blur the notion of a flat cut edge.
  for(i=0;i<n-1;i++){
    if(r.chance(.70))continue;
    var t=r.range(0,1),q=p(points[i],points[i+1],t);
    var ang=tang(points[i],points[i+1]),side=r.chance(.5)?1:-1;
    var pt=move(q,ang+Math.PI/2,side*half*r.range(.55,1.05));
    brush(ctx,move(pt,ang+Math.PI,r.range(7,22)),
      move(pt,ang,r.range(18,58)),r.range(7,24),
      pick(r,side>0?COLOR.pale:COLOR.mid),r.range(.24,.63),r,true);
  }
}
function junctions(chains,w,h){
  var map={},nodeList=[];
  function add(point,other,weight){
    var key=Math.round(point.x/34)+':'+Math.round(point.y/34);
    if(!map[key]){map[key]={x:0,y:0,count:0,rays:[],score:0};nodeList.push(map[key]);}
    var n=map[key];
    n.x+=point.x;n.y+=point.y;n.count++;
    n.score+=weight;
    var theta=tang(point,other);
    if(!n.rays.some(function(ray){return Math.abs(Math.atan2(Math.sin(ray.theta-theta),Math.cos(ray.theta-theta)))<.24;})){
      n.rays.push({theta:theta,len:dist(point,other)});
    }
  }
  for(var i=0;i<chains.length;i++){
    var ps=chains[i].pts;
    for(var j=1;j<ps.length;j++){
      var a=ps[j-1],b=ps[j],length=dist(a,b);
      if(length<8)continue;
      add(a,b,clamp(length/40,.5,2));
      add(b,a,clamp(length/40,.5,2));
    }
  }
  var out=nodeList.filter(function(n){return n.count>=3&&n.rays.length>=3});
  out.forEach(function(n){n.x/=n.count;n.y/=n.count;n.score*=Math.min(3,n.rays.length);});
  out.sort(function(a,b){return b.score-a.score});
  return out.slice(0,32);
}
function paintPlanes(ctx,nodes,r,voids,level){
  for(var i=0;i<Math.min(nodes.length,Math.ceil(38*level));i++){
    var n=nodes[i];
    if(inVoid(n.x,n.y,voids)&&r.chance(.72))continue;
    var rays=n.rays.slice().sort(function(a,b){return a.theta-b.theta});
    for(var j=0;j<rays.length;j++){
      var a=rays[j],b=rays[(j+1)%rays.length];
      var angle=Math.atan2(Math.sin(b.theta-a.theta),Math.cos(b.theta-a.theta));
      if(angle<=0)angle+=Math.PI*2;
      if(angle<.32||angle>2.55)continue;
      if(!r.chance(.47))continue;
      var c={x:n.x,y:n.y},radius=r.range(75,185);
      var endA=move(c,a.theta,Math.min(radius,a.len*PHI+55));
      var endB=move(c,b.theta,Math.min(radius,b.len*PHI+55));
      var outer=move(p(endA,endB,.5),tang(c,p(endA,endB,.5)),r.range(-26,56));
      ctx.save();
      ctx.globalAlpha=r.range(.44,.85);
      ctx.fillStyle=pick(r,r.chance(.6)?COLOR.pale:COLOR.mid);
      ctx.beginPath();
      ctx.moveTo(c.x,c.y);ctx.lineTo(endA.x,endA.y);
      ctx.quadraticCurveTo(outer.x,outer.y,endB.x,endB.y);
      ctx.closePath();ctx.fill();ctx.restore();
      // The edges follow the same originating φ structure.
      brush(ctx,c,endA,r.range(6,24),pick(r,COLOR.pale),r.range(.23,.67),r,true);
      if(r.chance(.62)){
        brush(ctx,c,endB,r.range(9,28),pick(r,COLOR.mid),r.range(.22,.51),r,true);
      }
    }
  }
}
function spine(ctx,chains,r,voids,level){
  // Reserve a few larger continuous raised ridges instead of re-stamping
  // every little source segment as a rectangular piece. Dark lines are
  // discontinuous only where a separate paint layer interrupts them.
  for(var i=0;i<chains.length;i++){
    if(i>Math.ceil(22*level))break;
    var pts=chains[i].pts;
    for(var j=1;j<pts.length;j++){
      var a=pts[j-1],b=pts[j],length=dist(a,b);
      if(length<7)continue;
      var count=Math.max(1,Math.ceil(length/70));
      for(var k=0;k<count;k++){
        if(r.chance(i<12?.30:.72))continue;
        var p1=p(a,b,k/count),p2=p(a,b,(k+1)/count);
        if(inVoid((p1.x+p2.x)/2,(p1.y+p2.y)/2,voids)&&r.chance(.7))continue;
        var ang=tang(p1,p2),normal=ang+Math.PI/2;
        var w=r.range(3.5,11)*(i<10?1.3:.75);
        var from=move(p1,normal,r.range(-12,12));
        var to=move(p2,normal,r.range(-12,12));
        brush(ctx,from,to,w,pick(r,COLOR.deep),r.range(.72,.98),r,true);
        brush(ctx,move(from,normal,w*.47),move(to,normal,w*.47),
          Math.max(1.5,w*.17),pick(r,COLOR.warm),r.range(.33,.76),r,false);
        if(r.chance(.56))brush(ctx,move(from,normal,-w*.32),
          move(to,normal,-w*.32),w*r.range(.15,.36),
          pick(r,COLOR.pale),r.range(.52,.94),r,false);
      }
    }
  }
}
function impasto(ctx,chains,nodes,r,level){
  // Knife flecks cluster at real joints, not at invented central focal points.
  for(var i=0;i<Math.min(nodes.length,Math.ceil(25*level));i++){
    var n=nodes[i],count=r.int(2,6);
    for(var j=0;j<count;j++){
      var a={x:n.x+r.range(-30,30),y:n.y+r.range(-30,30)};
      var theta=r.range(0,Math.PI*2),length=r.range(5,38);
      var palette=r.chance(.58)?COLOR.warm:(r.chance(.5)?COLOR.deep:COLOR.pale);
      brush(ctx,a,move(a,theta,length),r.range(2.5,16),
        pick(r,palette),r.range(.55,1),r,true);
    }
  }
  // Scumbled paint and light-catching dry-brush filaments.
  for(i=0;i<Math.ceil(38*level);i++){
    if(!chains.length)break;
    var ch=pick(r,chains),pts=ch.pts;
    var pos=pick(r,pts),angle=r.range(0,Math.PI*2);
    if(pts.length>1){
      var k=r.int(0,pts.length-2);
      angle=tang(pts[k],pts[k+1])+r.range(-.3,.3);
    }
    var q=move(pos,angle+Math.PI/2,r.range(-70,70));
    brush(ctx,q,move(q,angle,r.range(5,70)),r.range(.7,4.5),
      pick(r,r.chance(.55)?COLOR.pale:COLOR.warm),r.range(.33,.84),r,false);
  }
}
function finish(ctx,w,h,r,level){
  ctx.save();
  for(var i=0;i<Math.floor(3400*level);i++){
    // Micro-relief kept subtle; large-scale brushwork supplies real texture.
    ctx.globalAlpha=r.range(.018,.11);
    ctx.fillStyle=r.chance(.54)?'#ffffff':'#363f38';
    var x=r.range(0,w),y=r.range(0,h);
    ctx.fillRect(x,y,r.range(.6,3),r.range(.4,2.2));
  }
  ctx.restore();
}
// Convert the *actual recorded Marker strokes* into an RGB ink kit.
// Marker already chose these colours from seed + palette/colour controls;
// no second arbitrary palette is introduced.
function tissueStrokeRGB(value){
  var m=String(value||'').trim().match(/^hsl\(\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i);
  if(m){
    var h=((+m[1]%360)+360)%360/60,s=+m[2]/100,l=+m[3]/100;
    var chroma=(1-Math.abs(2*l-1))*s,x=chroma*(1-Math.abs(h%2-1)),v=l-chroma/2;
    var t=h<1?[chroma,x,0]:h<2?[x,chroma,0]:h<3?[0,chroma,x]:
      h<4?[0,x,chroma]:h<5?[x,0,chroma]:[chroma,0,x];
    return t.map(function(k){return Math.round(Math.max(0,Math.min(255,(k+v)*255)))});
  }
  m=String(value||'').trim().match(/^#([\da-f]{6})$/i);
  if(m)return [0,2,4].map(function(i){return parseInt(m[1].slice(i,i+2),16)});
  m=String(value||'').trim().match(/^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*\)$/i);
  return m?[+m[1],+m[2],+m[3]]:null;
}
function tissueHex(rgb){
  return '#'+rgb.map(function(n){return Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0')}).join('');
}
function tissueBlend(a,b,t){return a.map(function(n,i){return Math.round(n*(1-t)+b[i]*t)})}
// Change hue only: retain each V1 pigment's saturation/lightness and each
// palette group's length. This leaves all V1 RNG choices and drawing passes intact.
function seededV1Pigment(hex,ink){
  var rgb=tissueStrokeRGB(hex).map(function(v){return v/255});
  var hi=Math.max.apply(null,rgb),lo=Math.min.apply(null,rgb),l=(hi+lo)/2;
  var sat=hi===lo?0:(hi-lo)/(1-Math.abs(2*l-1));
  var top=Math.max.apply(null,ink),bottom=Math.min.apply(null,ink),delta=top-bottom;
  if(!delta)return tissueHex([l*255,l*255,l*255]);
  var h=top===ink[0]?((ink[1]-ink[2])/delta)%6:
    top===ink[1]?(ink[2]-ink[0])/delta+2:(ink[0]-ink[1])/delta+4;
  h=(h*60+360)%360;
  return tissueHex(tissueStrokeRGB('hsl('+h+' '+sat*100+'% '+l*100+'%)'));
}
A.seededV1Pigment=seededV1Pigment;
function tissueKit(paths,s,revision){
  var inks=[],seen={},count=Math.max(1,Math.min(24,Math.round(s.colourCount||4)));
  for(var i=0;i<paths.length;i++){
    var value=paths[i].stroke;
    if(!value||seen[value])continue;
    var rgb=tissueStrokeRGB(value);
    if(!rgb)continue;
    seen[value]=true;inks.push(rgb);
    if(inks.length>=count)break;
  }
  // E.g. a genuinely empty composition or an early archived strategy.
  if(!inks.length){
    var backup=A.hues(s,A.makeR(s.seed+'|tissue-fallback-palette'));
    inks=backup.map(tissueStrokeRGB).filter(Boolean);
  }
  var paper=revision>=4?[245,240,230]:(tissueStrokeRGB(s.paper)||[242,235,221]),dark=[26,27,27];
  return {
    revision:revision||2,
    paperRGB:paper,
    paper:tissueHex(paper),
    inkRGB:inks,
    ink:inks.map(tissueHex),
    cream:inks.map(function(col){return tissueHex(tissueBlend(col,paper,.83))}),
    soft:inks.map(function(col){return tissueHex(tissueBlend(col,paper,.38))}),
    deep:inks.map(function(col){return tissueHex(tissueBlend(col,dark,.58))})
  };
}
A.tissueKitFromPaths=tissueKit;

function paint(ctx,w,h,paths,meta,seed,quality,kit){
  // OIL-4: separate pigment and height buffers, shaded as material.
  // Preserve the OIL-3 implementation below as an experimental fallback.
  if(A.oilMaterial){
    A.oilMaterial(ctx,w,h,skeleton(paths,quality<.4?95:250),meta,seed,quality,kit);
    return;
  }
  var r=A.makeR(seed+'|oil-material-v2');
  var level=quality<.4?.40:quality<.85?.68:1;
  var chains=skeleton(paths,quality<.4?95:250);
  var voids=meta.voids||[];
  if(A.oilSurface)A.oilSurface(ctx,w,h,chains,seed,quality);
  else{ctx.fillStyle=COLOR.canvas;ctx.fillRect(0,0,w,h)}
  paintGround(ctx,w,h,chains,r,level);
  var nodes=junctions(chains,w,h);
  paintPlanes(ctx,nodes,r,voids,level);
  // Deep, continuous underpainting follows whole chains, not detached dabs.
  var total=Math.min(chains.length,Math.ceil(25*level));
  for(var i=total-1;i>=0;i--){
    var line=chains[i],pts=line.pts;
    if(pts.length<2)continue;
    var width=clamp(35+Math.sqrt(line.length)*r.range(3.4,7.5),58,188);
    if(i>=total*.7)width*=.65;
    sweepRegion(ctx,pts,width/2,toneFor(r,i),r,r.range(.53,.88));
  }
  // Let some smaller supporting planes join the larger ones.
  for(i=total;i<Math.min(chains.length,total+Math.ceil(5*level));i++){
    line=chains[i];
    sweepRegion(ctx,line.pts,r.range(17,44),pick(r,COLOR.ground),r,r.range(.39,.68));
  }
  spine(ctx,chains,r,voids,level);
  impasto(ctx,chains,nodes,r,level);
  finish(ctx,w,h,r,level);
}

// The checkbox changes only the material. The unmodified V8 composition
// (and its historic RNG sequence) is rendered offscreen to obtain vector
// geometry. Turning Oil off reproduces precisely the original marker work.
A.renderOil=function(target,s,scale,showGeometry,materialRevision){
  scale=scale||1;
  var w=s.orientation==='portrait'?1000:1400;
  var h=s.orientation==='portrait'?1400:1000;
  var prior=A.svgRecorder,rec={precise:true,paths:[],paperMarks:[]};
  var meta,scratch=document.createElement('canvas');
  try{
    A.svgRecorder=rec;
    meta=A.render(scratch,s,Math.min(1,Math.max(.1,scale)),false);
  }finally{A.svgRecorder=prior}
  target.width=w*scale;target.height=h*scale;
  var ctx=target.getContext('2d');
  if(scale!==1)ctx.scale(scale,scale);
  paint(ctx,w,h,rec.paths,meta,s.seed+'|'+s.mode+'|'+A.rendererVersion,scale,
    materialRevision>=2?tissueKit(rec.paths,s,materialRevision):null);
  if(showGeometry)A.geometryOverlay(ctx,s,meta);
  A.lastRenderMeta=meta;
  return meta;
};
})(window.AlgoArt);
