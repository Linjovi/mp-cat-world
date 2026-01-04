/*
 * NeuQuant Neural-Net Quantization Algorithm
 * ------------------------------------------
 *
 * Copyright (c) 1994 Anthony Dekker
 *
 * NEUQUANT Neural-Net quantization algorithm by Anthony Dekker, 1994.
 * See "Kohonen neural networks for optimal colour quantization"
 * in "Network: Computation in Neural Systems" Vol. 5 (1994) pp 351-367.
 * for a discussion of the algorithm.
 */

var netsize = 256; /* number of colours used */

/* four primes near 500 - assume no image has a length so large */
/* that it is divisible by all four primes */
var prime1 = 499;
var prime2 = 491;
var prime3 = 487;
var prime4 = 503;

var minpicturebytes = (3 * prime4); /* minimum size for input image */

/* Network Definitions
   ------------------- */

var maxnetpos = (netsize - 1);
var netbiasshift = 4; /* bias for colour values */
var ncycles = 100; /* no. of learning cycles */

/* defs for freq and bias */
var intbiasshift = 16; /* bias for fractions */
var intbias = (1 << intbiasshift);
var gammashift = 10; /* gamma = 1024 */
var gamma = (1 << gammashift);
var betashift = 10;
var beta = (intbias >> betashift); /* beta = 1/1024 */
var betagamma = (intbias << (gammashift - betashift));

/* defs for decreasing radius factor */
var initrad = (netsize >> 3); /* for 256 cols, radius starts */
var radiusbiasshift = 6; /* at 32.0 biased by 6 bits */
var radiusbias = (1 << radiusbiasshift);
var initradius = (initrad * radiusbias); /* and decreases by a */
var radiusdec = 30; /* factor of 1/30 each cycle */

/* defs for alpha */
var alphabiasshift = 10; /* alpha starts at 1.0 */
var initalpha = (1 << alphabiasshift);
var alphadec; /* biased by 10 bits */

/* radpower for precomputation */
var radbiasshift = 8;
var radbias = (1 << radbiasshift);
var alpharadbshift = (alphabiasshift + radbiasshift);
var alpharadbias = (1 << alpharadbshift);

/* Initialise network in range (0,0,0) to (255,255,255) and set parameters
   ----------------------------------------------------------------------- */

function NeuQuant(thepic, len, sample) {

    var i;
    var p;

    this.thepicture = thepic;
    this.lengthcount = len;
    this.samplefac = sample;

    this.network = new Array(netsize);
    this.netindex = new Array(256);
    this.bias = new Array(netsize);
    this.freq = new Array(netsize);
    this.radpower = new Array(initrad);

    for (i = 0; i < netsize; i++) {
        this.network[i] = new Array(4);
        p = this.network[i];
        p[0] = p[1] = p[2] = (i << (netbiasshift + 8)) / netsize;
        this.freq[i] = intbias / netsize; /* 1/netsize */
        this.bias[i] = 0;
    }
}

NeuQuant.prototype.colorMap = function () {
    var map = [];
    var index = new Array(netsize);
    for (var i = 0; i < netsize; i++)
        index[this.network[i][3]] = i;
    var k = 0;
    for (var l = 0; l < netsize; l++) {
        var j = index[l];
        map[k++] = (this.network[j][0]);
        map[k++] = (this.network[j][1]);
        map[k++] = (this.network[j][2]);
    }
    return map;
};

/* Mk: 25-05-2018 */ // eslint-disable-line camelcase
NeuQuant.prototype.quantize = function () {
    this.learn();
    this.unbiasnet();
    this.inxbuild();
    return this.colorMap();
};

/* Unbias network to give byte values 0..255 and record position i to prepare for sort
   ----------------------------------------------------------------------------------- */

NeuQuant.prototype.unbiasnet = function () {
    var i;
    for (i = 0; i < netsize; i++) {
        this.network[i][0] >>= netbiasshift;
        this.network[i][1] >>= netbiasshift;
        this.network[i][2] >>= netbiasshift;
        this.network[i][3] = i; /* record colour no */
    }
};

/* Move neuron i towards biased (b,g,r) by factor alpha
   ---------------------------------------------------- */

NeuQuant.prototype.altersingle = function (alpha, i, b, g, r) {
    /* alter hit neuron */
    var n = this.network[i];
    n[0] -= (alpha * (n[0] - b)) / initalpha;
    n[1] -= (alpha * (n[1] - g)) / initalpha;
    n[2] -= (alpha * (n[2] - r)) / initalpha;
};

/* Move adjacent neurons by precomputed alpha*(1-((i-j)^2/[r]^2)) in radpower[|i-j|]
   --------------------------------------------------------------------------------- */

NeuQuant.prototype.alterneigh = function (rad, i, b, g, r) {
    var j, k, lo, hi, a, m, p;

    lo = i - rad;
    if (lo < -1) lo = -1;
    hi = i + rad;
    if (hi > netsize) hi = netsize;

    j = i + 1;
    k = i - 1;
    m = 1;
    while ((j < hi) || (k > lo)) {
        a = this.radpower[m++];
        if (j < hi) {
            p = this.network[j++];
            try {
                p[0] -= (a * (p[0] - b)) / alpharadbias;
                p[1] -= (a * (p[1] - g)) / alpharadbias;
                p[2] -= (a * (p[2] - r)) / alpharadbias;
            } catch (e) { } // prevents 1.3 miscompilation
        }
        if (k > lo) {
            p = this.network[k--];
            try {
                p[0] -= (a * (p[0] - b)) / alpharadbias;
                p[1] -= (a * (p[1] - g)) / alpharadbias;
                p[2] -= (a * (p[2] - r)) / alpharadbias;
            } catch (e) { }
        }
    }
};

/* Search for biased BGR values
   ---------------------------- */

NeuQuant.prototype.contest = function (b, g, r) {
    /* finds closest neuron (min dist) and updates freq */
    /* finds best neuron (min dist-bias) and returns position */
    /* for frequently chosen neurons, freq[i] is high and bias[i] is negative */
    /* bias[i] = gamma*((1/netsize)-freq[i]) */

    var i, dist, a, biasdist, betafreq;
    var bestpos, bestbiaspos, bestd, bestbiasd;
    var n;

    bestd = ~((1 << 31));
    bestbiasd = bestd;
    bestpos = -1;
    bestbiaspos = bestpos;

    for (i = 0; i < netsize; i++) {
        n = this.network[i];
        dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
        if (dist < bestd) {
            bestd = dist;
            bestpos = i;
        }
        biasdist = dist - ((this.bias[i]) >> (intbiasshift - netbiasshift));
        if (biasdist < bestbiasd) {
            bestbiasd = biasdist;
            bestbiaspos = i;
        }
        betafreq = (this.freq[i] >> betashift);
        this.freq[i] -= betafreq;
        this.bias[i] += (betafreq << gammashift);
    }
    this.freq[bestpos] += beta;
    this.bias[bestpos] -= betagamma;
    return (bestbiaspos);
};

/* Main Learning Loop
   ------------------ */

NeuQuant.prototype.learn = function () {
    var i, j, b, g, r;
    var radius, rad, alpha, step, delta, samplepixels;
    var px, py, pix, lim, p;

    if (this.lengthcount < minpicturebytes) this.samplefac = 1;
    alphadec = 30 + ((this.samplefac - 1) / 3);
    p = this.thepicture;
    pix = 0;
    lim = this.lengthcount;
    samplepixels = this.lengthcount / (3 * this.samplefac);
    delta = (samplepixels / ncycles) | 0;
    alpha = initalpha;
    radius = initradius;

    rad = radius >> radiusbiasshift;
    if (rad <= 1) rad = 0;
    for (i = 0; i < rad; i++)
        this.radpower[i] = alpha * (((rad * rad - i * i) * radbias) / (rad * rad));


    if (this.lengthcount < minpicturebytes) step = 3;
    else if ((this.lengthcount % prime1) !== 0) step = 3 * prime1;
    else {
        if ((this.lengthcount % prime2) !== 0) step = 3 * prime2;
        else {
            if ((this.lengthcount % prime3) !== 0) step = 3 * prime3;
            else step = 3 * prime4;
        }
    }

    i = 0;
    while (i < samplepixels) {
        b = (p[pix + 0] & 0xff) << netbiasshift;
        g = (p[pix + 1] & 0xff) << netbiasshift;
        r = (p[pix + 2] & 0xff) << netbiasshift;
        j = this.contest(b, g, r);

        this.altersingle(alpha, j, b, g, r);
        if (rad !== 0) this.alterneigh(rad, j, b, g, r); /* alter neighbours */

        pix += step;
        if (pix >= lim) pix -= this.lengthcount;

        i++;
        if (delta === 0) delta = 1;
        if (i % delta === 0) {
            alpha -= alpha / alphadec;
            radius -= radius / radiusdec;
            rad = radius >> radiusbiasshift;
            if (rad <= 1) rad = 0;
            for (j = 0; j < rad; j++)
                this.radpower[j] = alpha * (((rad * rad - j * j) * radbias) / (rad * rad));
        }
    }
};

/* Search for BGR values 0..255 (after net is unbiased) and return colour index
   ---------------------------------------------------------------------------- */

NeuQuant.prototype.map = function (b, g, r) {
    var i, j, dist, a, bestd, best;
    var p;

    bestd = 1000; /* biggest possible dist is 256*3 */
    best = -1;
    i = this.netindex[g]; /* index on g */
    j = i - 1; /* start at netindex[g] and work outwards */

    while ((i < netsize) || (j >= 0)) {
        if (i < netsize) {
            p = this.network[i];
            dist = p[1] - g; /* inx key */
            if (dist >= bestd) i = netsize; /* stop iter */
            else {
                i++;
                if (dist < 0) dist = -dist;
                a = p[0] - b;
                if (a < 0) a = -a;
                dist += a;
                if (dist < bestd) {
                    a = p[2] - r;
                    if (a < 0) a = -a;
                    dist += a;
                    if (dist < bestd) {
                        bestd = dist;
                        best = p[3];
                    }
                }
            }
        }
        if (j >= 0) {
            p = this.network[j];
            dist = g - p[1]; /* inx key */
            if (dist >= bestd) j = -1; /* stop iter */
            else {
                j--;
                if (dist < 0) dist = -dist;
                a = p[0] - b;
                if (a < 0) a = -a;
                dist += a;
                if (dist < bestd) {
                    a = p[2] - r;
                    if (a < 0) a = -a;
                    dist += a;
                    if (dist < bestd) {
                        bestd = dist;
                        best = p[3];
                    }
                }
            }
        }
    }
    return (best);
};

/* Insertion sort of network and building of netindex[0..255] (to do after unbias)
   ------------------------------------------------------------------------------- */

NeuQuant.prototype.inxbuild = function () {
    var i, j, smallpos, smallval;
    var p;
    var q;
    var previouscol, startpos;

    previouscol = 0;
    startpos = 0;
    for (i = 0; i < netsize; i++) {
        p = this.network[i];
        smallpos = i;
        smallval = p[1]; /* index on g */
        /* find smallest in i..netsize-1 */
        for (j = i + 1; j < netsize; j++) {
            q = this.network[j];
            if (q[1] < smallval) {
                smallpos = j;
                smallval = q[1];
            }
        }
        q = this.network[smallpos];
        /* swap p (i) and q (smallpos) entries */
        if (i != smallpos) {
            j = q[0];
            q[0] = p[0];
            p[0] = j;
            j = q[1];
            q[1] = p[1];
            p[1] = j;
            j = q[2];
            q[2] = p[2];
            p[2] = j;
            j = q[3];
            q[3] = p[3];
            p[3] = j;
        }
        /* smallval entry is now in position i */
        if (smallval != previouscol) {
            this.netindex[previouscol] = (startpos + i) >> 1;
            for (j = previouscol + 1; j < smallval; j++)
                this.netindex[j] = i;
            previouscol = smallval;
            startpos = i;
        }
    }
    this.netindex[previouscol] = (startpos + maxnetpos) >> 1;
    for (j = previouscol + 1; j < 256; j++)
        this.netindex[j] = maxnetpos; /* really 256 */
};

module.exports = NeuQuant;
