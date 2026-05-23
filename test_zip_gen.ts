import JSZip from 'jszip';
import fs from 'fs';

// Local zip regeneration smoke test for JoEbook packaging flow.

async function test() {
  console.log("Creating dummy zip with 24.9MB content...");
  const zip = new JSZip();
  // Add a 24MB file
  const bigBuffer = Buffer.alloc(24 * 1024 * 1024, 'X');
  zip.file("ppt/media/big_video.mp4", bigBuffer);
  // Add some XML
  zip.file("ppt/slides/slide1.xml", "<a:p>Hello</a:p>");
  
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  console.log("Original zip buffer size:", zipBuffer.length);

  // Now, let's load it and recreate it (simulating translatePptx)
  const zip2 = await JSZip.loadAsync(zipBuffer);
  const slide1 = await zip2.file("ppt/slides/slide1.xml")?.async("string");
  console.log("Slide1:", slide1);
  zip2.file("ppt/slides/slide1.xml", "<a:p>Translated</a:p>");
  
  const finalBuffer = await zip2.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  console.log("Final buffer size:", finalBuffer.length);
}
test().catch(console.error);
