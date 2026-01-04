/*
 * LZWEncoder.js
 * Authors:
 *   Kevin Weiner (original Java version - kweiner@fmsware.com)
 *   Thibault Imbert (AS3 version - bytearray.org)
 *   Johan Nordberg (JS version - code@johan-nordberg.com)
 *
 * Adapted for WeChat Mini Program
 */

var EOF = -1;

// GIFCOMPR.C       - GIF Image compression routines
//
// Lempel-Ziv & Welch compress
//
// Modified by : David Rowley
//
// GIF Image compression - modified 'compress'
//
// Based on: compress.c - File compression ala IEEE Computer, June 1984.
//
// By Authors:  Spencer W. Thomas       (decvax!harpo!utah-cs!utah-gr!thomas)
//              Jim McKie               (decvax!mcvax!jim)
//              Steve Davies            (decvax!vax135!petsd!joe)
//              Ken Turkowski           (decvax!decwrl!turtlevax!ken)
//              James A. Woods          (decvax!ihnp4!ames!jaw)
//              Joe Orost               (decvax!vax135!petsd!joe)

function LZWEncoder(width, height, pixels, color_depth) {
    this.imgW = width;
    this.imgH = height;
    this.pixAry = pixels;
    this.initCodeSize = Math.max(2, color_depth);

    this.accum = new Uint8Array(256);
    this.htab = new Int32Array(5003);
    this.codetab = new Int32Array(5003);

    this.cur_accum = 0;
    this.cur_bits = 0;
    this.a_count = 0;
    this.free_ent = 0;
    this.clear_flg = false;
    this.g_init_bits = 0;
    this.n_bits = 0;
    this.maxcode = 0;
    this.ClearCode = 0;
    this.EOFCode = 0;
    this.remaining = 0;
    this.curPixel = 0;
}

// Add a character to the end of the current packet, and if it is 254
// characters, flush the packet to disk.
LZWEncoder.prototype.char_out = function (c, outs) {
    this.accum[this.a_count++] = c;
    if (this.a_count >= 254) this.flush_char(outs);
};

// Clear out the hash table
// table clear for block compress
LZWEncoder.prototype.cl_block = function (outs) {
    this.cl_hash(5003);
    this.free_ent = this.ClearCode + 2;
    this.clear_flg = true;
    this.output(this.ClearCode, outs);
};

// reset code table
LZWEncoder.prototype.cl_hash = function (hsize) {
    for (var i = 0; i < hsize; ++i) this.htab[i] = -1;
};

LZWEncoder.prototype.compress = function (init_bits, outs) {
    var fcode;
    var i /* = 0 */;
    var c;
    var ent;
    var disp;
    var hsize_reg;
    var hshift;

    // Set up the globals:  g_init_bits - initial number of bits
    this.g_init_bits = init_bits;

    // Set up the necessary values
    this.clear_flg = false;
    this.n_bits = this.g_init_bits;
    this.maxcode = this.MAXCODE(this.n_bits);

    this.ClearCode = 1 << (init_bits - 1);
    this.EOFCode = this.ClearCode + 1;
    this.free_ent = this.ClearCode + 2;

    this.a_count = 0; // clear packet

    ent = this.nextPixel();

    hshift = 0;
    for (fcode = 5003; fcode < 65536; fcode *= 2)
        ++hshift;
    hshift = 8 - hshift; // set hash code range bound

    hsize_reg = 5003;
    this.cl_hash(hsize_reg); // clear hash table

    this.output(this.ClearCode, outs);

    outer_loop: while ((c = this.nextPixel()) != EOF) {
        fcode = (c << 12) + ent; // maxbits = 12
        i = (c << hshift) ^ ent; // xor hashing

        if (this.htab[i] === fcode) {
            ent = this.codetab[i];
            continue;
        } else if (this.htab[i] >= 0) { // non-empty slot

            disp = hsize_reg - i; // secondary hash (after G. Knott)
            if (i === 0)
                disp = 1;

            do {
                if ((i -= disp) < 0)
                    i += hsize_reg;

                if (this.htab[i] === fcode) {
                    ent = this.codetab[i];
                    continue outer_loop;
                }
            } while (this.htab[i] >= 0);
        }

        this.output(ent, outs);
        ent = c;
        if (this.free_ent < (1 << 12)) {
            this.codetab[i] = this.free_ent++; // code -> hashtable
            this.htab[i] = fcode;
        } else
            this.cl_block(outs);
    }

    this.output(ent, outs);
    this.output(this.EOFCode, outs);
};

LZWEncoder.prototype.encode = function (outs) {
    outs.writeByte(this.initCodeSize); // write "initial code size" byte
    this.remaining = this.imgW * this.imgH; // reset navigation variables
    this.curPixel = 0;
    this.compress(this.initCodeSize + 1, outs); // compress and write the pixel data
    outs.writeByte(0); // write block terminator
};

// Flush the packet to disk, and reset the accumulator
LZWEncoder.prototype.flush_char = function (outs) {
    if (this.a_count > 0) {
        outs.writeByte(this.a_count);
        outs.writeBytes(this.accum, 0, this.a_count);
        this.a_count = 0;
    }
};

LZWEncoder.prototype.MAXCODE = function (n_bits) {
    return (1 << n_bits) - 1;
};

LZWEncoder.prototype.nextPixel = function () {
    if (this.remaining === 0) return EOF;
    --this.remaining;
    var pix = this.pixAry[this.curPixel++];
    return pix & 0xff;
};

LZWEncoder.prototype.output = function (code, outs) {
    this.cur_accum &= [0x0000, 0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f, 0x00ff, 0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff, 0xffff][this.cur_bits];

    if (this.cur_bits > 0)
        this.cur_accum |= (code << this.cur_bits);
    else
        this.cur_accum = code;

    this.cur_bits += this.n_bits;

    while (this.cur_bits >= 8) {
        this.char_out((this.cur_accum & 0xff), outs);
        this.cur_accum >>= 8;
        this.cur_bits -= 8;
    }

    // If the next entry is going to be too big for the code size,
    // then increase it, if possible.

    if (this.free_ent > this.maxcode || this.clear_flg) {

        if (this.clear_flg) {

            this.maxcode = this.MAXCODE(this.n_bits = this.g_init_bits);
            this.clear_flg = false;

        } else {

            ++this.n_bits;
            if (this.n_bits == 12)
                this.maxcode = (1 << 12);
            else
                this.maxcode = this.MAXCODE(this.n_bits);
        }
    }

    if (code == this.EOFCode) {

        while (this.cur_bits > 0) {
            this.char_out((this.cur_accum & 0xff), outs);
            this.cur_accum >>= 8;
            this.cur_bits -= 8;
        }

        this.flush_char(outs);
    }
};

module.exports = LZWEncoder;
