/*
 * GIFEncoder.js
 * Authors:
 *   Kevin Weiner (original Java version - kweiner@fmsware.com)
 *   Thibault Imbert (AS3 version - bytearray.org)
 *   Johan Nordberg (JS version - code@johan-nordberg.com)
 *
 * Adapted for WeChat Mini Program
 */

var NeuQuant = require('./NeuQuant.js');
var LZWEncoder = require('./LZWEncoder.js');

function GIFEncoder() {
    var width, height;
    var transparent = null; // transparent color if given
    var transIndex; // transparent index in color table
    var repeat = -1; // no repeat
    var delay = 0; // frame delay (hundredths)
    var started = false; // ready to output?
    var out;
    var image; // current frame
    var pixels; // BGR byte array from frame
    var indexedPixels; // converted frame indexed to palette
    var colorDepth; // number of bit planes
    var colorTab; // RGB palette
    var usedEntry = []; // active palette entries
    var palSize = 7; // color table size (bits-1)
    var dispose = -1; // disposal code (-1 = use default)
    var firstFrame = true;
    var sample = 10; // default sample interval for quantizer

    var maxColors = 256; // max number of colors

    var ByteArray = function () {
        this.page = [];
        this.cursor = 0;

        this.getData = function () {
            // return new Uint8Array(this.page);
            return this.page;
        };

        this.writeByte = function (val) {
            this.page[this.cursor++] = val;
        };

        this.writeBytes = function (array, offset, length) {
            for (var i = 0; i < length; i++) {
                this.writeByte(array[i + offset]);
            }
        };

        this.writeString = function (str) {
            for (var i = 0; i < str.length; i++) {
                this.writeByte(str.charCodeAt(i));
            }
        };
    };

    /**
     * Sets the delay time between each frame, or changes it for subsequent frames
     * (applies to last frame added)
     *
     * @param milliseconds int delay time in milliseconds
     */
    this.setDelay = function (milliseconds) {
        delay = Math.round(milliseconds / 10);
    };

    /**
     * Sets frame rate in frames per second. Equivalent to
     * <code>setDelay(1000/fps)</code>.
     *
     * @param fps float frame rate (frames per second)
     */
    this.setFrameRate = function (fps) {
        delay = Math.round(100 / fps);
    };

    /**
     * Sets the GIF frame disposal code for the last added frame and any
     * subsequent frames.
     *
     * @param code int disposal code.
     */
    this.setDispose = function (code) {
        if (code >= 0) dispose = code;
    };

    /**
     * Sets the number of times the set of GIF frames should be played.
     *
     * @param iter int number of iterations.
     * @return
     */
    this.setRepeat = function (iter) {
        if (iter >= 0) repeat = iter;
    };

    /**
     * Sets the transparent color for the last added frame and any subsequent
     * frames. Since all colors are subject to modification in the quantization
     * process, the color in the final palette for each frame closest to the given
     * color becomes the transparent color for that frame. May be set to null to
     * indicate no transparent color.
     *
     * @param
     * @param color Color to be treated as transparent on display.
     */
    this.setTransparent = function (color) {
        transparent = color;
    };

    /**
     * Adds next GIF frame. The frame is not written immediately, but is
     * actually deferred until the next frame is received so that timing
     * data can be inserted.  Invoking <code>finish()</code> flushes all
     * frames.
     *
     * @param imageData ImageData containing width, height, and data (Uint8ClampedArray)
     */
    this.addFrame = function (imageData) {
        if ((imageData == null) || !started) return false;

        var w = imageData.width;
        var h = imageData.height;

        // width/height from first frame
        if (width === undefined || height === undefined) {
            width = w;
            height = h;
        }

        if (w !== width || h !== height) {
            // Ideally resize or warn. For now, assume consistent.
        }

        image = imageData.data; // The Uint8ClampedArray (RGBA)
        getImagePixels(); // convert to correct format if necessary
        analyzePixels(); // build color table & map pixels

        if (firstFrame) {
            writeLSD(); // logical screen descriptior
            writePalette(); // global color table
            if (repeat >= 0) {
                // use NS app extension to indicate reps
                writeNetscapeExt();
            }
        }

        writeGraphicCtrlExt(); // write graphic control extension
        writeImageDesc(); // image descriptor
        if (!firstFrame) writePalette(); // local color table
        writePixels(); // encode and write pixel data
        firstFrame = false;

        return true;
    };

    /**
     * Adds final trailer to the GIF stream, if you don't call the finish method
     * the GIF stream will not be valid.
     */
    this.finish = function () {
        if (!started) return false;
        out.writeByte(0x3b); // gif trailer
        started = false;
        return true;
    };

    /**
     * Sets quality of color quantization (conversion of images to the
     * maximum 256 colors allowed by the GIF specification).
     * Lower values (minimum = 1) produce better colors, but slow processing
     * significantly. 10 is the default, and produces good color mapping at
     * reasonable speeds. Values greater than 20 do not yield significant
     * improvements in speed.
     *
     * @param quality int greater than 0.
     * @return
     */
    this.setQuality = function (quality) {
        if (quality < 1) quality = 1;
        sample = quality;
    };

    /**
     * Initiates GIF file creation on the given stream.
     *
     * @param os OutputStream on which GIF images are written.
     * @return false if initial write failed.
     */
    this.start = function () {
        out = new ByteArray();
        started = true;
        out.writeString("GIF89a"); // header
        return true;
    };

    this.getStream = function () {
        return out;
    };

    var analyzePixels = function () {
        var len = pixels.length;
        var nPix = len / 3;
        indexedPixels = new Uint8Array(nPix);

        var nq = new NeuQuant(pixels, len, sample);
        colorTab = nq.quantize(); // create reduced palette

        // Fix: NeuQuant returns BGR palette, but GIF expects RGB. Swap R and B in colorTab.
        // Also map pixels expects BGR input because NeuQuant was trained on BGR.
        
        // 1. Quantize returns BGR palette. We need to swap it to RGB for the GIF file.
        for (var i = 0; i < colorTab.length; i += 3) {
            var temp = colorTab[i];
            colorTab[i] = colorTab[i + 2];
            colorTab[i + 2] = temp;
        }

        // 2. Map pixels. 
        // CAUTION: The 'pixels' array contains BGR data (from getImagePixels).
        // NeuQuant's 'map' function expects BGR values (b, g, r).
        
        var k = 0;
        for (var j = 0; j < nPix; j++) {
            // map(b, g, r)
            var b = pixels[k++] & 0xff;
            var g = pixels[k++] & 0xff;
            var r = pixels[k++] & 0xff;
            var index = nq.map(b, g, r);
            usedEntry[index] = true;
            indexedPixels[j] = index;
        }

        pixels = null;
        colorDepth = 8;
        palSize = 7;

        // get closest match to transparent color if specified
        if (transparent !== null) {
            transIndex = findClosest(transparent);
        }
    };

    var findClosest = function (c) {
        if (colorTab === null) return -1;
        var r = (c & 0xFF0000) >> 16;
        var g = (c & 0x00FF00) >> 8;
        var b = (c & 0x0000FF);
        var minpos = 0;
        var dmin = 256 * 256 * 256;
        var len = colorTab.length;

        for (var i = 0; i < len;) {
            var dr = r - (colorTab[i++] & 0xff);
            var dg = g - (colorTab[i++] & 0xff);
            var db = b - (colorTab[i] & 0xff);
            var d = dr * dr + dg * dg + db * db;
            var index = i / 3;
            if (usedEntry[index] && (d < dmin)) {
                dmin = d;
                minpos = index;
            }
            i++;
        }
        return minpos;
    };

    var getImagePixels = function () {
        var w = width;
        var h = height;
        pixels = new Uint8Array(w * h * 3);
        var data = image;
        var count = 0;

        for (var i = 0; i < h; i++) {
            for (var j = 0; j < w; j++) {
                var b = (i * w * 4) + j * 4;
                // Native Canvas data is RGBA, GIF expects BGR (or RGB depending on impl)
                // NeuQuant expects BGR: method NeuQuant(thepic, len, sample)
                // p[0] is Blue, p[1] is Green, p[2] is Red

                pixels[count++] = data[b + 2]; // B
                pixels[count++] = data[b + 1]; // G
                pixels[count++] = data[b];     // R
            }
        }
    };

    var writeGraphicCtrlExt = function () {
        out.writeByte(0x21); // extension introducer
        out.writeByte(0xf9); // GCE label
        out.writeByte(4); // data block size
        var transp, disp;
        if (transparent === null) {
            transp = 0;
            disp = 0; // dispose = no action
        } else {
            transp = 1;
            disp = 2; // force clear if using transparent color
        }
        if (dispose >= 0) {
            disp = dispose & 7; // user override
        }
        disp <<= 2;

        // packed fields
        out.writeByte(0 | // 1:3 reserved
            disp | // 4:6 disposal
            0 | // 7 user input - 0 = none
            transp); // 8 transparency flag

        out.writeByte(delay & 0xFF); // delay x 1/100
        out.writeByte((delay >> 8) & 0xFF);
        out.writeByte(transIndex); // transparent color index
        out.writeByte(0); // block terminator
    };

    var writeImageDesc = function () {
        out.writeByte(0x2c); // image separator
        out.writeByte(0); // image position x,y = 0,0
        out.writeByte(0);
        out.writeByte(0);
        out.writeByte(0);
        out.writeByte(width & 0xFF); // image size
        out.writeByte((width >> 8) & 0xFF);
        out.writeByte(height & 0xFF);
        out.writeByte((height >> 8) & 0xFF);
        // packed fields
        if (firstFrame) {
            // no LCT  - GCT is used for first (or only) frame
            out.writeByte(0);
        } else {
            // specify normal LCT
            out.writeByte(0x80 | // 1 local color table 1=yes
                0 | // 2 interlace - 0=no
                0 | // 3 sorted - 0=no
                0 | // 4-5 reserved
                palSize); // 6-8 size of color table
        }
    };

    var writeLSD = function () {
        // logical screen size
        out.writeByte(width & 0xFF);
        out.writeByte((width >> 8) & 0xFF);
        out.writeByte(height & 0xFF);
        out.writeByte((height >> 8) & 0xFF);
        // packed fields
        out.writeByte(0x80 | // 1 : global color table flag = 1 (gct used)
            0x70 | // 2-4 : color resolution = 7
            0x00 | // 5 : gct sort flag = 0
            palSize); // 6-8 : gct size

        out.writeByte(0); // background color index
        out.writeByte(0); // pixel aspect ratio - assume 1:1
    };

    var writeNetscapeExt = function () {
        out.writeByte(0x21); // extension introducer
        out.writeByte(0xff); // app extension label
        out.writeByte(11); // block size
        out.writeString("NETSCAPE2.0"); // app id + auth code
        out.writeByte(3); // sub-block size
        out.writeByte(1); // loop sub-block id
        out.writeByte(repeat & 0xFF); // loop count (extra iterations, 0=forever)
        out.writeByte((repeat >> 8) & 0xFF);
        out.writeByte(0); // block terminator
    };

    var writePalette = function () {
        out.writeBytes(colorTab, 0, colorTab.length);
        var n = (3 * 256) - colorTab.length;
        for (var i = 0; i < n; i++) out.writeByte(0);
    };

    var writePixels = function () {
        var enc = new LZWEncoder(width, height, indexedPixels, colorDepth);
        enc.encode(out);
    };
}

module.exports = GIFEncoder;
