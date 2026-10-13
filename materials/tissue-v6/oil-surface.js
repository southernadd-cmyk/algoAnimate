// Procedural oil underpainting / surface shading.
// The palette field is derived from existing ALGO/ART vector geometry.
// No image synthesis model, uploaded texture, dependency or network request.
window.AlgoArt=window.AlgoArt||{};
(function(A){
'use strict';
function clamp(a,b,c){return Math.max(b,Math.min(c,a))}
function smooth(x){return x*x*(3-2*x)}
function lerp(a,b,t){return a+(b-a)*t}
function rgb(hex){return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]}
var BASE=[241,235,225];
var PIGMENTS=[
  [104,128,129], // mineral blue/grey
  [119,125,103], // muted olive
  [178,114,72],  // burnt sienna
  [159,163,147], // weathered green grey
  [190,153,103], // ochre
  [95,118,118],  // smoky teal
  [208,188,156]  // pale warm impasto
];
function mixhash(i,j,s){
  var k=Math.imul(i,374761393)^Math.imul(j,668265263)^s;
  k=Math.imul(k^(k>>>13),1274126177);
  return ((k^(k>>>16))>>>0)/4294967295;
}
function noise(x,y,scale,seed){
  var ax=x/scale,ay=y/scale,ix=Math.floor(ax),iy=Math.floor(ay),u=smooth(ax-ix),v=smooth(ay-iy);
  return lerp(lerp(mixhash(ix,iy,seed),mixhash(ix+1,iy,seed),u),
    lerp(mixhash(ix,iy+1,seed),mixhash(ix+1,iy+1,seed),u),v)*2-1;
}
function distanceSq(x,y,seg){
  var px=seg.b.x-seg.a.x,py=seg.b.y-seg.a.y,d=seg.d;
  var t=d>0?clamp(((x-seg.a.x)*px+(y-seg.a.y)*py)/d,0,1):0;
  var nx=x-seg.a.x-t*px,ny=y-seg.a.y-t*py;
  return nx*nx+ny*ny;
}
A.oilSurface=function(ctx,w,h,chains,seed,quality,kit){
  var base=kit?kit.paperRGB:BASE;
  var v1=kit&&kit.revision>=4;
  var pigments=v1?PIGMENTS.map(function(col,i){
    var hex='#'+col.map(function(n){return n.toString(16).padStart(2,'0')}).join('');
    return rgb(A.seededV1Pigment(hex,kit.inkRGB[i%kit.inkRGB.length]));
  }):(kit?kit.inkRGB:PIGMENTS);
  var S=A.hash(seed+'|ground-field|1')>>>0;
  var segments=[],i,j,c,pts;
  for(i=0;i<Math.min(26,chains.length);i++){
    c=chains[i];pts=c.pts;
    var skip=Math.max(1,Math.ceil((pts.length-1)/9));
    for(j=skip;j<pts.length;j+=skip){
      var a=pts[j-skip],b=pts[j],dx=b.x-a.x,dy=b.y-a.y;
      if(dx*dx+dy*dy>25){
        segments.push({a:a,b:b,d:dx*dx+dy*dy,group:i,importance:Math.sqrt(c.length)});
      }
    }
  }
  // Coarse distance field captures structure; fine raster provides pigment grain.
  var grid=20,cols=Math.ceil(w/grid)+2,rows=Math.ceil(h/grid)+2;
  var fields=new Array(cols*rows),reach=kit&&!v1?118:170;
  for(j=0;j<rows;j++)for(i=0;i<cols;i++){
    var x=i*grid,y=j*grid,nearest=Infinity,chosen=-1;
    for(var k=0;k<segments.length;k++){
      var ds=distanceSq(x,y,segments[k]);
      if(ds<nearest){nearest=ds;chosen=k}
    }
    var gn=noise(x,y,105,S^321),an=noise(x,y,53,S^912);
    var effective=Math.sqrt(nearest)+gn*32+an*14;
    var t=clamp((reach-effective)/reach,0,1);
    t=smooth(t);
    var pigment=chosen<0?base:pigments[(segments[chosen].group+A.hash(seed+'|tone|'+segments[chosen].group))%pigments.length];
    var reachTint=chosen<0?0:clamp(.08+t*.78,0,.86);
    // Pale reserve areas persist, even among several nearby paths.
    var atmospheric=clamp(t*.8+.15*noise(x,y,215,S^141),0,1);
    if(v1&&t===0)reachTint=0;
    var shade=kit&&!v1?(.08+atmospheric*.60)*reachTint:(.11+atmospheric*.87)*reachTint;
    fields[j*cols+i]=[
      lerp(base[0],pigment[0],shade),
      lerp(base[1],pigment[1],shade),
      lerp(base[2],pigment[2],shade),
      shade
    ];
  }
  var pixelRatio=quality<.5?3:(quality<.95?2.5:2);
  var rw=Math.max(1,Math.ceil(w/pixelRatio)),rh=Math.max(1,Math.ceil(h/pixelRatio));
  var small=document.createElement('canvas');
  small.width=rw;small.height=rh;
  var sc=small.getContext('2d');
  var data=sc.createImageData(rw,rh),buf=data.data;
  for(j=0;j<rh;j++){
    var yy=(j+.5)*h/rh,vv=yy/grid,gy=clamp(Math.floor(vv),0,rows-2),ty=smooth(vv-gy);
    for(i=0;i<rw;i++){
      var xx=(i+.5)*w/rw,uu=xx/grid,gx=clamp(Math.floor(uu),0,cols-2),tx=smooth(uu-gx);
      var a=fields[gy*cols+gx],b=fields[gy*cols+gx+1];
      var d=fields[(gy+1)*cols+gx],e=fields[(gy+1)*cols+gx+1];
      var broad=noise(xx,yy,78,S^115);
      var medium=noise(xx,yy,22,S^456);
      var fine=noise(xx,yy,5,S^987);
      var height=broad*.58+medium*.28+fine*.14;
      // Directional light from top-left gives subtle oil relief.
      var relief=(noise(xx+3,yy-4,22,S^456)-medium)*13+fine*4.5;
      var fleck=mixhash(i,j,S^441)-.5;
      var grain=kit&&!v1?(height*5+relief*.24+fleck*1.8):(height*14+relief+fleck*3.5);
      if(v1){
        // Retain V1 pigment grain inside the wash. Bare paper uses restrained
        // grain: V1's global highlight used to bleach this noise to white.
        var coverage=lerp(lerp(a[3],b[3],tx),lerp(d[3],e[3],tx),ty);
        grain*=.18+.82*clamp(coverage*3,0,1);
      }
      var id=(j*rw+i)*4;
      for(k=0;k<3;k++){
        var base=lerp(lerp(a[k],b[k],tx),lerp(d[k],e[k],tx),ty);
        buf[id+k]=clamp(Math.round(base+grain),0,255);
      }
      buf[id+3]=255;
    }
  }
  sc.putImageData(data,0,0);
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.drawImage(small,0,0,w,h);
  ctx.restore();
};
})(window.AlgoArt);
