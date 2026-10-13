// ALGO/ART OIL-4 experimental MATERIAL buffer renderer.
// Original implementation informed by the height/pigment separation in
// PigmentLab (https://github.com/wieslawsoltes/PigmentLab) and Wet Paint Flow
// (https://github.com/simonxxooxxoo/wet-paint-flow). No source code or assets
// are copied. Source compositions and V8 marker output remain untouched.
// Browser Canvas2D only; no trained models, GPU requirement, network or installs.
window.AlgoArt=window.AlgoArt||{};
(function(A){
'use strict';
var PI=Math.PI;
var C={
  cream:['#f6eee1','#e8ded0','#f0e8db','#ddd5c4'],
  blue:['#657e7d','#829a98','#9eaead','#b3c0b6'],
  umber:['#544d43','#364b4a','#6a6854','#526461'],
  olive:['#6d7e67','#929788','#a6a895'],
  ochre:['#bc803f','#ce9a5b','#a9623e','#ddba80']
};
// The first material revision is frozen for all historical share links.
// Revised material derives *every* coloured layer from recorded Marker inks.
var originalC=C;
function coloursForInk(kit){
  if(kit.revision>=4){
    var seeded={};
    Object.keys(originalC).forEach(function(group,groupIndex){
      seeded[group]=group==='umber'?originalC.umber:originalC[group].map(function(col,i){
        return A.seededV1Pigment(col,kit.inkRGB[(groupIndex+i)%kit.inkRGB.length]);
      });
    });
    return seeded;
  }
  return {
    cream:kit.cream,
    blue:kit.ink,
    // Keep the original dark graphite pigment. Pigment washes remain
    // seeded, while pencil structural strokes must not inherit their hue.
    umber:kit.revision>=3?originalC.umber:kit.deep,
    olive:kit.soft,
    ochre:kit.ink.length>1?kit.ink.slice(1).concat(kit.ink[0]):kit.ink
  };
}
function clamp(x,a,b){return Math.min(b,Math.max(a,x))}
function mix(a,b,t){return a+(b-a)*t}
function lerpHex(a,b,t){
  function colour(v){
    if(v[0]==='#')return [1,3,5].map(function(k){return parseInt(v.slice(k,k+2),16)});
    var m=v.match(/[0-9]+/g);
    return m&&m.length>=3?m.slice(0,3).map(Number):[180,170,155];
  }
  var c=colour(a),d=colour(b);
  var cs=c.map(function(x,i){return Math.round(mix(x,d[i],t))});
  return 'rgb('+cs.join(',')+')';
}
function point(a,b,t){return{x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)}}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function angle(a,b){return Math.atan2(b.y-a.y,b.x-a.x)}
function shift(pt,dir,d){return{x:pt.x+Math.cos(dir)*d,y:pt.y+Math.sin(dir)*d}}
function palette(i,r){
  var group=i%9;
  if(group<3)return r.pick(C.blue);
  if(group<5)return r.pick(C.olive);
  if(group<7)return r.pick(C.cream);
  if(group===7)return r.pick(C.umber);
  return r.pick(C.ochre);
}
// Material revisions 5 and 6 share the approved torn contours. Source V4
// pigment, geometry, coverage, graphite and RNG sequence remain unchanged.
// The serration displaces the EXISTING edge: it draws no additional strokes.
var tissueTornEdges=false;
var tissueLightEnabled=false;
var lightTissueStats={pieces:0};
function tornTrace(ctx,edge,half,side){
  var step=7.5,depth=clamp(half*.068,1.2,3.3);
  for(var i=1;i<edge.length;i++){
    var a=edge[i-1],b=edge[i],dx=b.x-a.x,dy=b.y-a.y;
    var dist=Math.hypot(dx,dy);
    if(dist<.00001)continue;
    var normalX=-dy/dist,normalY=dx/dist;
    var divisions=Math.max(1,Math.ceil(dist/step));
    for(var j=1;j<=divisions;j++){
      var t=j/divisions,x=a.x+dx*t,y=a.y+dy*t;
      var rough=.54*Math.sin(x*.39+y*.61+i*.29)+
        .28*Math.sin(x*1.43-y*.86+i*1.89)+
        .18*Math.sin(x*3.11+y*2.77+i*.41);
      // Irregular but short local tears: no uniform sawtooth and no halos.
      var offset=side*depth*rough;
      ctx.lineTo(x+normalX*offset,y+normalY*offset);
    }
  }
}
function ribbon(ctx,pts,half,r){
  var left=[],right=[],n=pts.length,i;
  if(n<2)return false;
  // V5: a closed rectangle/circle repeats its start at the end. The old
  // open-strip treatment used two different end normals there, creating
  // an incorrectly filled triangular corner on very broad washes. Close
  // the two contour loops instead. V1–V4 remain byte-for-byte unchanged.
  var closed=tissueTornEdges&&n>=4&&dist(pts[0],pts[n-1])<18;
  var unique=closed?n-1:n;
  for(i=0;i<n;i++){
    var before=closed?pts[(i+unique-1)%unique]:pts[Math.max(0,i-1)];
    var after=closed?pts[(i+1)%unique]:pts[Math.min(n-1,i+1)];
    var normal=angle(before,after)+PI/2;
    var taper=closed?1:Math.min(1,.45+Math.min(i,n-i-1)*.47);
    var width=half*taper*(.88+.12*Math.sin(i*1.37)+r.range(-.095,.095));
    left.push(shift(pts[i],normal,width));
    right.push(shift(pts[i],normal,-width*r.range(.80,1.12)));
  }
  if(closed){
    // Consume the same RNG samples as the old ribbon: later layers retain
    // their seed-selected colours/positions, only this seam is repaired.
    left.pop();right.pop();n=unique;
  }
  ctx.beginPath();ctx.moveTo(left[0].x,left[0].y);
  if(tissueTornEdges){
    // Trace both loops continuously; for open paths retain the exact V5
    // torn-edge treatment already approved.
    tornTrace(ctx,closed?left.concat(left[0]):left,half,1);
    if(closed){
      // Join adjacent inner/outer corners, never opposite corners.
      // Opposite-corner closure would introduce a diagonal false pigment plane.
      ctx.lineTo(right[0].x,right[0].y);
      tornTrace(ctx,[right[0]].concat(right.slice().reverse()),half,-1);
    }else{
      ctx.lineTo(right[n-1].x,right[n-1].y);
      tornTrace(ctx,right.slice().reverse(),half,-1);
    }
  }else{
    for(i=1;i<n;i++){
      var m=point(left[i-1],left[i],.5);
      ctx.quadraticCurveTo(m.x,m.y,left[i].x,left[i].y);
    }
    ctx.lineTo(right[n-1].x,right[n-1].y);
    for(i=n-2;i>=0;i--){
      m=point(right[i+1],right[i],.5);
      ctx.quadraticCurveTo(m.x,m.y,right[i].x,right[i].y);
    }
  }
  ctx.closePath();return true;
}
function pathStroke(ctx,pts,width,col,alpha){
  if(pts.length<2)return;
  ctx.save();ctx.globalAlpha=alpha;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.lineWidth=width;ctx.strokeStyle=col;
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  for(var i=1;i<pts.length;i++){
    var m=point(pts[i-1],pts[i],.5);
    ctx.quadraticCurveTo(m.x,m.y,pts[i].x,pts[i].y);
  }
  ctx.stroke();ctx.restore();
}
function paintRibbon(pig,height,pts,width,r,col,opacity,thickness){
  if(!ribbon(pig,pts,width*.5,r))return;
  pig.save();pig.globalAlpha=opacity;pig.fillStyle=col;pig.fill();pig.clip();
  // Dry and wet streaks share the original tangent; the noise is material,
  // not another geometry generator. All stripes remain inside the paint mass.
  var count=Math.round(clamp(width/13,3,9)),i;
  for(i=0;i<count;i++){
    var offset=(i/(count-1)-.5)*width*.95,ps=[];
    for(var j=0;j<pts.length;j++){
      var before=pts[Math.max(0,j-1)],after=pts[Math.min(pts.length-1,j+1)];
      var normal=angle(before,after)+PI/2;
      ps.push(shift(pts[j],normal,offset+r.range(-width*.045,width*.045)));
    }
    var alternate=i%8===0?C.ochre:(i%3===0?C.cream:C.umber);
    var tint=lerpHex(col,r.pick(alternate),r.range(.035,.31));
    pathStroke(pig,ps,r.range(.7,3.7),tint,r.range(.05,.23));
  }
  pig.restore();
  // Grayscale height accumulates with lighter blending: real deposited paint
  // has thickness, separate from pigment colour. Bristle grooves are not
  // painted-on highlights; they change this heightmap itself.
  height.save();height.globalCompositeOperation='lighter';
  ribbon(height,pts,width*.5,r);
  height.globalAlpha=clamp(.28+thickness*.18,.2,.75);
  var layer=Math.round(clamp(18+thickness*34,16,96));
  height.fillStyle='rgb('+layer+','+layer+','+layer+')';height.fill();
  for(i=0;i<count;i++){
    if(r.chance(.23))continue;
    offset=(i/(count-1)-.5)*width*.83;ps=[];
    for(j=0;j<pts.length;j++){
      before=pts[Math.max(0,j-1)];after=pts[Math.min(pts.length-1,j+1)];
      normal=angle(before,after)+PI/2;
      ps.push(shift(pts[j],normal,offset+r.range(-width*.018,width*.018)));
    }
    pathStroke(height,ps,r.range(.65,2.9),
      r.chance(.12)?'rgb(34,34,34)':'rgb(12,12,12)',r.range(.28,.70));
  }
  height.restore();
}
function linePath(a,b,centre,r){
  // Third point gives the loaded brush a soft change of angle. The direction
  // is inherited from the skeleton's tangent, not a random global rotation.
  var q=point(a,b,.5),theta=angle(a,b)+PI/2;
  return [a,shift(q,theta,r.range(-centre,centre)),b];
}
function insideVoid(pt,voids){
  for(var i=0;i<voids.length;i++){
    var v=voids[i];
    if(pt.x>=v.x&&pt.x<=v.x+v.w&&pt.y>=v.y&&pt.y<=v.y+v.h)return true;
  }
  return false;
}
function paintPlanes(pig,height,chains,voids,r,allowance){
  // Solid pigment planes grow off existing structure segments, giving the
  // viewer a painted field instead of many parallel geometric wireframes.
  var n=Math.min(chains.length,Math.ceil(31*allowance));
  for(var i=n-1;i>=0;i--){
    var pts=chains[i].pts;
    if(pts.length<2)continue;
    var j=r.int(1,pts.length-1),a=pts[j-1],b=pts[j],len=dist(a,b);
    if(len<18)continue;
    var middle=point(a,b,.5);
    if(insideVoid(middle,voids)&&r.chance(.9))continue;
    var normal=angle(a,b)+PI/2,side=r.chance(.5)?1:-1;
    var span=clamp(Math.sqrt(chains[i].length)*r.range(3.8,9.2),80,270);
    var pA=shift(a,normal,side*span*r.range(.35,.65));
    var pB=shift(b,normal,side*span*r.range(.68,1.2));
    var apex=shift(point(pA,pB,.5),normal,side*r.range(0,span*.3));
    var warm=r.chance(.21);
    var col=warm?r.pick(C.ochre):(r.chance(.55)?r.pick(C.cream):r.pick(C.blue));
    var mixcol=lerpHex(col,r.pick(C.cream),r.range(.06,.38));
    function shape(ctx){
      ctx.beginPath();ctx.moveTo(a.x,a.y);
      ctx.quadraticCurveTo(middle.x+normal*0,middle.y,b.x,b.y);
      ctx.quadraticCurveTo(pB.x,pB.y,apex.x,apex.y);
      ctx.quadraticCurveTo(pA.x,pA.y,a.x,a.y);ctx.closePath();
    }
    pig.save();shape(pig);pig.fillStyle=mixcol;
    pig.globalAlpha=r.range(.36,.77);pig.fill();pig.clip();
    // Broad, restrained scumbles inside the SAME painted plane.
    for(var k=0;k<r.int(3,7);k++){
      var c=point(a,b,r.range(.10,.9));
      var offset=shift(c,normal,side*r.range(span*.1,span*.88));
      var tangent=angle(a,b)+r.range(-.25,.25);
      var e=shift(offset,tangent,r.range(30,115));
      pathStroke(pig,[offset,e],r.range(6,25),
        lerpHex(col,r.pick(k%2?C.cream:C.umber),r.range(.1,.55)),
        r.range(.11,.32));
    }
    pig.restore();
    height.save();height.globalCompositeOperation='lighter';shape(height);
    height.fillStyle='rgb(38,38,38)';height.globalAlpha=r.range(.18,.48);
    height.fill();height.restore();
  }
}
// Pale translucent scraps along existing source chains. This is an additive
// material pass, not a global whitening/blur or a replacement composition.
// It runs between the existing colour masses and final V1 pencil details.
function addLightTissue(pig,height,w,h,chains,voids,seed,quality){
  var phi=1.61803398875,r=A.makeR(seed+'|light-tissue-v6'),candidates=[];
  var sw=pig.canvas.width,sh=pig.canvas.height,ratio=sw/w;
  var pixels=pig.getImageData(0,0,sw,sh).data;
  function luminance(pt){
    var x=clamp(Math.round(pt.x*ratio),0,sw-1),y=clamp(Math.round(pt.y*ratio),0,sh-1);
    var k=(y*sw+x)*4;
    return pixels[k]*.2126+pixels[k+1]*.7152+pixels[k+2]*.0722;
  }
  function section(pts,start,end){
    var result=[],travel=0;
    for(var j=1;j<pts.length;j++){
      var len=dist(pts[j-1],pts[j]);
      if(len>.001&&travel+len>start&&travel<end){
        var lo=clamp((start-travel)/len,0,1),hi=clamp((end-travel)/len,0,1);
        if(!result.length)result.push(point(pts[j-1],pts[j],lo));
        result.push(point(pts[j-1],pts[j],hi));
      }
      travel+=len;if(travel>=end)break;
    }
    return result;
  }
  for(var i=0;i<Math.min(chains.length,112);i++){
    var ch=chains[i];
    if(ch.length<70||ch.pts.length<2)continue;
    var length=0;
    for(var j=1;j<ch.pts.length;j++)length+=dist(ch.pts[j-1],ch.pts[j]);
    var span=clamp(Math.sqrt(ch.length)*r.range(4.8,7.4),90,230);
    span=Math.min(span,length*.82);
    for(var t=0;t<2;t++){
      var fraction=(t?1/phi:1/(phi*phi))+r.range(-.075,.075);
      var centre=clamp(length*fraction,span*.5,length-span*.5);
      var pts=section(ch.pts,centre-span*.5,centre+span*.5);
      if(pts.length<2)continue;
      var middle=pts[Math.floor(pts.length/2)],width=clamp(span/(phi*phi)*r.range(.7,1.15),27,76);
      if(insideVoid(middle,voids))continue;
      // Keep intended paper reserves and canvas corners unpainted.
      if(pts.some(function(pt){return pt.x<width||pt.y<width||pt.x>w-width||pt.y>h-width||insideVoid(pt,voids)}))continue;
      var dir=angle(pts[0],pts[pts.length-1]),normal=dir+PI/2;
      var sample=[middle,shift(middle,normal,width*.25),shift(middle,normal,-width*.25)];
      var darkness=sample.reduce(function(sum,pt){return sum+Math.max(0,241-luminance(pt))},0)/sample.length;
      if(darkness<15)continue;
      candidates.push({pts:pts,centre:middle,width:width,darkness:darkness,score:darkness+r.range(-6,6)});
    }
  }
  candidates.sort(function(a,b){return b.score-a.score});
  var selected=[],count=quality<.4?4:8;
  for(i=0;i<candidates.length&&selected.length<count;i++){
    var candidate=candidates[i];
    if(selected.some(function(other){return dist(candidate.centre,other.centre)<Math.max(115,(candidate.width+other.width)*phi)}))continue;
    selected.push(candidate);
  }
  for(i=0;i<selected.length;i++){
    var item=selected[i],pts=item.pts,width=item.width;
    // Same V5 torn-contour function; its path is shared by pigment and height.
    var outlineSeed=seed+'|light-tissue-outline|'+i;
    pig.save();ribbon(pig,pts,width*.5,A.makeR(outlineSeed));
    var pale=lerpHex(C.cream[i%C.cream.length],'#fffaf0',r.range(.78,.93));
    var opacity=clamp(.30+item.darkness*.002,.34,.56);
    pig.globalAlpha=opacity;pig.fillStyle=pale;pig.fill();pig.clip();
    // Fine fibres are inside the scrap, with no added edge halo or blur.
    for(j=0;j<22;j++){
      var k=r.int(1,pts.length-1),a=pts[k-1],b=pts[k],dir=angle(a,b);
      var q=shift(point(a,b,r.n()),dir+PI/2,r.range(-width*.43,width*.43));
      pathStroke(pig,[q,shift(q,dir,r.range(3,20))],r.range(.4,.9),
        j%3?'#fffdf5':lerpHex(pale,C.cream[i%C.cream.length],.18),r.range(.035,.10));
    }
    pig.restore();
    height.save();ribbon(height,pts,width*.5,A.makeR(outlineSeed));
    height.globalCompositeOperation='lighter';height.globalAlpha=.22;
    height.fillStyle='rgb(21,21,21)';height.fill();height.restore();
  }
  return {pieces:selected.length,candidates:candidates.length,pass:'pale tissue before unchanged pencil details'};
}

function deposit(pig,height,w,h,chains,voids,seed,quality){
  var r=A.makeR(seed+'|paint-dab-4'),n=chains.length;
  var allowance=quality<.4?.5:1;
  paintPlanes(pig,height,chains,voids,r,allowance);
  // Localised translucent glazes knit separate paths together without
  // replacing the original geometry with a noise texture.
  var broad=Math.min(n,Math.round(24*allowance));
  for(var i=broad-1;i>=0;i--){
    var ch=chains[i],pts=ch.pts;
    if(pts.length<2)continue;
    var mid=pts[Math.floor(pts.length/2)];
    if(insideVoid(mid,voids)&&r.chance(.82))continue;
    var width=clamp(85+Math.sqrt(ch.length)*r.range(4.8,8.2),85,235);
    var muted=lerpHex(palette(i,r),r.pick(C.cream),r.range(.32,.73));
    paintRibbon(pig,height,pts,width,r,muted,r.range(.40,.69),r.range(.35,.80));
  }
  // Main painterly ribbons at two scales. Rhythm and large-scale direction
  // use the same φ-composed source segments.
  var hero=Math.min(n,Math.ceil(72*allowance));
  for(i=0;i<hero;i++){
    ch=chains[i];pts=ch.pts;
    if(pts.length<2)continue;
    if(insideVoid(pts[0],voids)&&r.chance(.66))continue;
    width=clamp(Math.sqrt(ch.length)*r.range(1.4,3.1),14,i<22?96:61);
    if(i>=broad&&r.chance(.32))continue;
    var hue=palette(i,r);
    paintRibbon(pig,height,pts,width,r,hue,r.range(.69,.94),
      r.range(.58,1.5));
  }
  // V6 adds approved pale tissue with an independent seeded RNG.
  // All original V5 pigment and pencil operations retain their exact sequence.
  if(tissueLightEnabled)lightTissueStats=addLightTissue(pig,height,w,h,chains,voids,seed,quality);
  // Broken small strokes and half-covered edges build material variation.
  var detail=Math.min(n,Math.ceil(112*allowance));
  for(i=0;i<detail;i++){
    ch=chains[i];pts=ch.pts;
    var skip=quality<.4?2:1;
    for(var j=1;j<pts.length;j+=skip){
      if(r.chance(.84))continue;
      var a=pts[j-1],b=pts[j],d=dist(a,b);
      if(d<4)continue;
      if(insideVoid(point(a,b,.5),voids)&&r.chance(.85))continue;
      var normal=angle(a,b)+PI/2;
      var off=r.range(-14,14);
      var base=linePath(shift(a,normal,off),shift(b,normal,off),d*.10,r);
      var shade=r.chance(.35)?r.pick(C.umber):(r.chance(.45)?r.pick(C.ochre):r.pick(C.cream));
      paintRibbon(pig,height,base,r.range(5,20),r,shade,
        r.range(.45,.90),r.range(.30,1.4));
    }
  }
}
// Bring back the distinct pencil/graphite linework lost when dark umbers
// were converted to seed-tinted pigments. It follows existing vector chains,
// adds no new composition geometry, and never touches historical v1 output.
function graphiteOverlay(ctx,chains,seed,quality){
  var r=A.makeR(seed+'|graphite-linework-v2'),n=Math.min(chains.length,quality<.4?24:85);
  var drawn=0;
  ctx.save();
  ctx.globalCompositeOperation='multiply';
  for(var i=0;i<n;i++){
    var path=chains[i].pts;
    if(path.length<2||r.chance(i<15?.10:.36))continue;
    var graphite=r.pick(originalC.umber);
    var weight=Math.max(.65,Math.min(3.4,chains[i].width*.24+r.range(.1,1.05)));
    var alpha=r.range(.26,.63)*(i<18?1:.76);
    pathStroke(ctx,path,weight,graphite,alpha);drawn++;
    // The second, slightly wandering pass is dry pencil grain along the
    // same sampled marks, not an opaque outline around every colour field.
    if(i<24&&r.chance(.48)){
      var lean=r.range(-2.2,2.2),offset=path.map(function(pt,j){
        var a=path[Math.max(0,j-1)],b=path[Math.min(path.length-1,j+1)];
        return shift(pt,angle(a,b)+PI/2,lean);
      });
      pathStroke(ctx,offset,Math.max(.5,weight*.44),graphite,alpha*.40);
    }
  }
  ctx.restore();
  return drawn;
}
function hashNoise(x,y,seed){
  var k=(Math.imul(x,374761393)^Math.imul(y,668265263)^seed)|0;
  k=Math.imul(k^(k>>>13),1274126177);
  return ((k^(k>>>16))>>>0)/4294967295;
}
function shade(pig,height,out,w,h,seed,kit){
  var source=pig.getImageData(0,0,w,h);
  var hg=height.getImageData(0,0,w,h).data;
  var px=source.data;
  var seedValue=A.hash(seed+'|microfacet|4');
  for(var y=1;y<h-1;y++){
    var row=y*w;
    for(var x=1;x<w-1;x++){
      var k=(row+x)*4;
      var center=hg[k];
      var dx=(hg[k+4]-hg[k-4])*.043;
      var dy=(hg[k+w*4]-hg[k-w*4])*.043;
      var fine=(hashNoise(x>>1,y>>1,seedValue)-.5)*.17;
      var nx=clamp(-dx+fine,-6,6),ny=clamp(-dy+fine,-6,6);
      var inv=1/Math.sqrt(nx*nx+ny*ny+1);
      var diffuse=clamp((nx*-.41+ny*-.54+1)*inv,0,1);
      // Off-centre light catches raised impasto; shadowed furrows keep depth.
      var spec=Math.pow(clamp((diffuse-.67)/.33,0,1),7);
      var cavity=clamp(Math.abs(dx)+Math.abs(dy),0,6);
      var bump=center/255;
      // Historical Tissue v1 lighting remains byte-for-byte untouched.
      // The v2 paper already contains the exact chosen cream colour:
      // the old 1.09× diffuse boost + specular shine clipped cream to white.
      // Keep v2 paper neutral; apply restrained relief only to raised pigment.
      var raised=kit?clamp((center-13)/48,0,1):1;
      var light=kit?(1+raised*(.055*(diffuse-.78)+.045*bump*spec-.010*cavity))
        :(.90+.19*diffuse+.14*bump*spec-.027*cavity);
      var shine=kit?raised*2.2*bump*spec:(9+26*bump)*spec;
      if(kit&&kit.revision>=4){
        // V1 relief on pigment; bare paper keeps its default cream base.
        light=1+raised*((.90+.19*diffuse+.14*bump*spec-.027*cavity)-1);
        shine=raised*(9+26*bump)*spec;
      }
      px[k]=clamp(Math.round(px[k]*light+shine),0,255);
      px[k+1]=clamp(Math.round(px[k+1]*light+shine*.91),0,255);
      px[k+2]=clamp(Math.round(px[k+2]*light+shine*.77),0,255);
    }
  }
  out.putImageData(source,0,0);
}
A.oilMaterial=function(ctx,w,h,chains,meta,seed,quality,kit){
  // Keep legacy C byte-identical for v1; protect against any synchronous
  // invocation after a seeded-material render by restoring it in finally.
  C=kit?coloursForInk(kit):originalC;
  tissueTornEdges=Boolean(kit&&kit.revision>=5);
  tissueLightEnabled=Boolean(kit&&kit.revision===6);
  lightTissueStats={pieces:0};
  try{
  // Work buffers are resolution-adaptive, but every pixel is re-rasterised
  // deterministically; no random browser texture or remote assets.
  var ratio=quality<.30?.32:(quality<.65?.53:(quality<1.5?.78:1.18));
  var sw=Math.max(1,Math.round(w*ratio)),sh=Math.max(1,Math.round(h*ratio));
  function layer(){var c=document.createElement('canvas');c.width=sw;c.height=sh;return c}
  var pc=layer(),hc=layer(),final=layer();
  var pctx=pc.getContext('2d'),hctx=hc.getContext('2d'),fctx=final.getContext('2d');
  pctx.scale(ratio,ratio);hctx.scale(ratio,ratio);
  if(A.oilSurface)A.oilSurface(pctx,w,h,chains,seed,quality,kit);
  else{pctx.fillStyle='#f2ebdd';pctx.fillRect(0,0,w,h)}
  hctx.fillStyle='rgb(13,13,13)';hctx.fillRect(0,0,w,h);
  var voids=meta.voids||[];
  deposit(pctx,hctx,w,h,chains,voids,seed,quality);
  // Restore transforms before readback in case this is reused later.
  pctx.setTransform(1,0,0,1,0,0);hctx.setTransform(1,0,0,1,0,0);
  shade(pctx,hctx,fctx,sw,sh,seed,kit);
  ctx.save();ctx.imageSmoothingEnabled=true;
  ctx.drawImage(final,0,0,w,h);
  var graphitePaths=kit&&kit.revision===3?graphiteOverlay(ctx,chains,seed,quality):0;
  ctx.restore();
  A.lastOilMaterialStats={width:sw,height:sh,chains:chains.length,buffer:'pigment+height',
    version:4,tissuePaletteVersion:kit?kit.revision:1,
    ...(tissueLightEnabled?{lightTissue:lightTissueStats}:{}),
    ...(kit?{inkColours:kit.ink.slice(),graphitePaths:graphitePaths}:{} )};
  }finally{C=originalC;tissueTornEdges=false;tissueLightEnabled=false}
};
})(window.AlgoArt);
