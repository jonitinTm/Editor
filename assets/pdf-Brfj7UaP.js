async function R(c,a,i,r=72){const p=a*72/r,d=i*72/r,g=new TextEncoder,$=[],f=[];let s=0;const e=t=>{const o=typeof t=="string"?g.encode(t):t;$.push(o),s+=o.length},n=(t,o,x)=>{f[t]=s,e(`${t} 0 obj
${o}
`),x&&(e(`stream
`),e(x),e(`
endstream
`)),e(`endobj
`)};e(`%PDF-1.4
%âãÏÓ
`);const l=g.encode(`q
${p.toFixed(2)} 0 0 ${d.toFixed(2)} 0 0 cm
/Im0 Do
Q
`);n(1,"<< /Type /Catalog /Pages 2 0 R >>"),n(2,"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),n(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.toFixed(2)} ${d.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),n(4,`<< /Type /XObject /Subtype /Image /Width ${a} /Height ${i} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${c.length} >>`,c),n(5,`<< /Length ${l.length} >>`,l);const h=s;return e(`xref
0 6
0000000000 65535 f 
${[1,2,3,4,5].map(t=>String(f[t]).padStart(10,"0")+` 00000 n 
`).join("")}`),e(`trailer
<< /Size 6 /Root 1 0 R >>
startxref
${h}
%%EOF
`),new Blob($,{type:"application/pdf"})}export{R as makePdf};
