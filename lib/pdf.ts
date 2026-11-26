function pdfText(value: unknown) {
 return String(value ?? '').replace(/₦/g,'NGN ').replace(/[–—]/g,'-').replace(/·/g,' | ')
  .normalize('NFKD').replace(/[^\x20-\x7E]/g,'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function wrapPdfLine(value:string,max=96) {
 if(!value)return [''];const out:string[]=[];let rest=value;
 while(rest.length>max){let split=rest.lastIndexOf(' ',max);if(split<Math.floor(max*.55))split=max;out.push(rest.slice(0,split));rest=rest.slice(split).trimStart()}
 out.push(rest);return out;
}
export function createTextPdf(sourceLines:string[]) {
 const printable:{text:string;size:number;bold:boolean}[]=[];
 for(const source of sourceLines){const raw=String(source??'');const title=raw.startsWith('# ');const heading=raw.startsWith('## ');const value=pdfText(raw.replace(/^#{1,2}\s*/,''));for(const part of wrapPdfLine(value,title?66:heading?82:96))printable.push({text:part,size:title?18:heading?12:9,bold:title||heading})}
 const pages:typeof printable[]=[];let page:typeof printable=[];let y=790;
 for(const line of printable){const step=line.size>=18?28:line.size>=12?21:14;if(y<54){pages.push(page);page=[];y=790}page.push(line);y-=step}
 if(page.length||!pages.length)pages.push(page);
 const objects:string[]=[];objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
 const pageIds=pages.map((_,i)=>5+i*2);
 objects[2]='<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pages.length+' >>';
 objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
 objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
 pages.forEach((lines,index)=>{const pageId=5+index*2,contentId=pageId+1;let cursor=790;
  const commands=lines.map(line=>{const step=line.size>=18?28:line.size>=12?21:14;const cmd='BT /'+(line.bold?'F2':'F1')+' '+line.size+' Tf 48 '+cursor+' Td ('+line.text+') Tj ET';cursor-=step;return cmd});
  commands.push('BT /F1 8 Tf 48 30 Td (Page '+(index+1)+' of '+pages.length+') Tj ET');
  const stream=commands.join('\n');
  objects[pageId]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+contentId+' 0 R >>';
  objects[contentId]='<< /Length '+Buffer.byteLength(stream,'ascii')+' >>\nstream\n'+stream+'\nendstream';
 });
 let output='%PDF-1.4\n';const offsets=[0];
 for(let id=1;id<objects.length;id++){offsets[id]=Buffer.byteLength(output,'ascii');output+=id+' 0 obj\n'+objects[id]+'\nendobj\n'}
 const xref=Buffer.byteLength(output,'ascii');output+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';
 for(let id=1;id<objects.length;id++)output+=String(offsets[id]).padStart(10,'0')+' 00000 n \n';
 output+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(output,'ascii');
}
