import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch'; // using node-fetch internally installed by TSX or otherwise available
import JSZip from 'jszip';

// Local repack smoke test for JoEbook document packaging.

async function generateDummyPptx() {
  const zip = new JSZip();
  // Add a 24MB file
  const bigBuffer = Buffer.alloc(24 * 1024 * 1024, 'A');
  zip.file("ppt/media/big_video.mp4", bigBuffer);
  // Add some XML
  zip.file("ppt/slides/slide1.xml", "<a:p><a:r><a:t>Hello World</a:t></a:r></a:p>");
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function startClient() {
  const fileBuffer = await generateDummyPptx();
  
  const form = new FormData();
  form.append('editedTranslationsJson', JSON.stringify(["Translated Text"]));
  form.append('targetLang', 'zh');
  form.append('file', fileBuffer, { filename: 'test.pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  
  const response = await fetch('http://localhost:3000/api/repack-document', {
    method: 'POST',
    body: form
  });
  
  if (response.ok) {
    const outBuffer = await response.buffer();
    console.log("Downloaded output buffer size:", outBuffer.length);
  } else {
    const errText = await response.text();
    console.log("Error:", errText);
  }
}

startClient().catch(console.error);
