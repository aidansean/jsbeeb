define([], function () {
    "use strict";
    return function Acia(cpu, toneGen) {
        var self = this;
        self.sr = 0x02;
        self.cr = 0x00;
        self.dr = 0x00;
        self.motorOn = false;

        function updateIrq() {
            if (self.sr & self.cr & 0x80) {
                cpu.interrupt |= 0x04;
            } else {
                cpu.interrupt &= ~0x04;
            }
        }

        self.reset = function () {
            self.sr = (self.sr & 0x08) | 0x04;
            self.motorOn = false;
            updateIrq();
        };
        self.reset();

        self.tone = function (freq) {
            if (!freq) toneGen.mute();
            else toneGen.tone(freq);
        };

        self.setMotor = function (on) {
            self.motorOn = on;
            if (!on) toneGen.mute();
        };

        self.read = function (addr) {
            if (addr & 1) {
                self.sr &= ~0x81;
                updateIrq();
                return self.dr;
            } else {
                // Return with the TDRE set. Not sure this is any different from just keeping the
                // TDRE bit set all the time.
                return (self.sr & 0x7f) | (self.sr & self.cr & 0x80) | 0x02;
            }
        };

        self.write = function (addr, val) {
            if (addr & 1) {
                // Ignore sends, except for clearing the TDRE.
                self.sr &= ~0x02;
                updateIrq();
            } else {
                if ((val & 0x03) === 0x03) {
                    // According to the 6850 docs writing 3 here doesn't affect any CR bits, but
                    // just resets the device.
                    self.reset();
                    return;
                } else {
                    self.cr = val;
                }
            }
        };

        self.selectRs423 = function (selected) {
            if (selected) {
                self.sr &= ~0x04; // Clear DCD
            } else {
                self.sr &= ~0x08; // Clear CTS
            }
        };

        self.setDCD = function (level) {
            if (level) {
                if (self.sr & 0x04) return;
                self.sr |= 0x84;
            } else {
                self.sr &= ~0x04;
            }
            updateIrq();
        };

        self.receive = function (byte) {
            byte |= 0;
            self.dr = byte;
            self.sr |= 0x81;
            updateIrq();
        };

        self.setTape = function (tape) {
            self.tape = tape;
        };

        var runCounter = 0;
        var cyclesPerPoll = (2 * 1000 * 1000) / 30;
        var serialReceiveRate = 19200;

        self.setSerialReceive = function (rate) {
            serialReceiveRate = rate;
        };

        function run() {
            if (self.tape) return self.tape.poll(self);
            return 100000;
        }

        self.polltime = function (cycles) {
            if (!self.motorOn) return;
            runCounter -= cycles;
            if (runCounter <= 0) {
                runCounter += run();
            }
        };

        self.secondsToPolls = function (sec) {
            return Math.floor(2 * 1000 * 1000 * sec / cyclesPerPoll);
        };
    };
});

function TapefileTape(stream) {
    "use strict";
    var self = this;

    self.count = 0;
    self.stream = stream;

    var dividerTable = [1, 16, 64, -1];

    function rate(acia) {
        var bitsPerByte = 9;
        if (!(acia.cr & 0x80)) {
            bitsPerByte++; // Not totally correct if the AUG is to be believed.
        }
        var divider = dividerTable[acia.cr & 0x03];
        // http://beebwiki.mdfs.net/index.php/Serial_ULA says the serial rate is ignored
        // for cassette mode.
        var cpp = (2 * 1000 * 1000) / (19200 / divider);
        return Math.floor(bitsPerByte * cpp);
    }

    self.poll = function (acia) {
        if (stream.eof()) return 100000;
        var byte = stream.readByte();
        if (byte === 0xff) {
            byte = stream.readByte();
            if (byte === 0) {
                acia.setDCD(false);
                return 0;
            } else if (byte === 0x04) {
                acia.setDCD(true);
                // Simulate 5 seconds of carrier.
                return 5 * 2 * 1000 * 1000;
            } else if (byte !== 0xff) {
                throw "Got a weird byte in the tape";
            }
        }
        acia.receive(byte);
        return rate(acia);
    };
}
