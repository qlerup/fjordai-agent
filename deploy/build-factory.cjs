const path=require('node:path');
require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../public/factory-scene.js')],bundle:true,minify:true,format:'iife',globalName:'FjordFactory',outfile:path.join(__dirname,'../public/factory3d.js'),legalComments:'eof',target:['es2022']});
