import {useLocalSearchParams} from 'expo-router';
import React, {useEffect, useMemo, useState} from 'react';

import {
  convertFrom,
  detectFormat,
  INPUT_FORMATS,
  type InputFormat,
} from '../../src/lib/convert.ts';
import {em4100FromHex, em4100FromParts} from '../../src/lib/em4100.ts';
import {describeError} from '../../src/lib/nfc.ts';
import {
  decodeWiegandBits,
  decodeWiegandHex,
  encodeWiegand26,
  encodeWiegand34,
  type WiegandDecode,
} from '../../src/lib/wiegand.ts';
import {
  Banner,
  Card,
  CopyRow,
  Field,
  Muted,
  Screen,
  Segmented,
} from '../../src/ui/components.tsx';

type Tool = 'bytes' | 'wiegand' | 'em4100';

const TOOLS: {value: Tool; label: string}[] = [
  {value: 'bytes', label: 'Bytes'},
  {value: 'wiegand', label: 'Wiegand'},
  {value: 'em4100', label: 'EM4100'},
];

export default function ConvertScreen() {
  const [tool, setTool] = useState<Tool>('bytes');

  return (
    <Screen>
      <Segmented options={TOOLS} value={tool} onChange={setTool} />
      {tool === 'bytes' ? <BytesTool /> : null}
      {tool === 'wiegand' ? <WiegandTool /> : null}
      {tool === 'em4100' ? <Em4100Tool /> : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Bytes                                                                       */
/* -------------------------------------------------------------------------- */

function BytesTool() {
  // The Read and History screens hand a UID over through route params.
  const params = useLocalSearchParams<{value?: string; format?: string}>();
  const [value, setValue] = useState(params.value ?? '04 A2 24 1B');
  const [format, setFormat] = useState<InputFormat>(
    (params.format as InputFormat | undefined) ?? 'hex',
  );

  useEffect(() => {
    if (params.value) {
      setValue(params.value);
      setFormat((params.format as InputFormat | undefined) ?? detectFormat(params.value));
    }
  }, [params.value, params.format]);

  const outcome = useMemo(() => {
    try {
      return {result: convertFrom(value, format)};
    } catch (error) {
      return {error: describeError(error)};
    }
  }, [value, format]);

  return (
    <>
      <Card
        title="Any notation to every notation"
        subtitle="Paste a UID, a payload or a plain number. Pick what it is, read it back however you need it.">
        <Segmented options={INPUT_FORMATS} value={format} onChange={setFormat} />
        <Field
          label="INPUT"
          value={value}
          onChangeText={(next) => {
            setValue(next);
            // Re-sniff only while the user has not pinned a format themselves.
            if (next.trim().length > 0 && format === detectFormat(value)) {
              setFormat(detectFormat(next));
            }
          }}
          multiline
          monospace={format !== 'text'}
          autoCapitalize={format === 'text' ? 'none' : 'characters'}
          placeholder="04 A2 24 1B"
        />
      </Card>

      {'error' in outcome ? (
        <Banner tone="danger">{outcome.error}</Banner>
      ) : (
        <>
          <Card title="Numeric">
            <CopyRow
              label="HEX"
              value={outcome.result.hex}
              hint={`${outcome.result.byteLength} bytes · ${outcome.result.bitLength} bits`}
            />
            <CopyRow label="HEX (SPACED)" value={outcome.result.hexSpaced} />
            <CopyRow label="HEX (COLONS)" value={outcome.result.hexColons} />
            <CopyRow label="DECIMAL" value={outcome.result.decimal} hint="Big-endian, unsigned" />
            <CopyRow label="BINARY" value={outcome.result.binary} />
          </Card>

          <Card title="Textual">
            <CopyRow label="UTF-8" value={outcome.result.text} />
            <CopyRow label="ASCII" value={outcome.result.ascii} hint="Non-printable bytes as dots" />
            <CopyRow label="BASE64" value={outcome.result.base64} />
          </Card>

          <Card
            title="Byte order"
            subtitle="Readers disagree about which end of a UID comes first. If your number is close but scrambled, it is probably one of these.">
            <CopyRow label="REVERSED (LSB FIRST)" value={outcome.result.reversedHex} />
            <CopyRow label="REVERSED AS DECIMAL" value={outcome.result.reversedDecimal} />
            <CopyRow
              label="BIT-REVERSED"
              value={outcome.result.bitReversedHex}
              hint="Each byte's bits flipped, byte order kept"
            />
          </Card>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Wiegand                                                                     */
/* -------------------------------------------------------------------------- */

type WiegandMode = 'decode' | 'encode';

function WiegandTool() {
  const [mode, setMode] = useState<WiegandMode>('decode');
  const [rawInput, setRawInput] = useState('10000000100000000000000010');
  const [bitLength, setBitLength] = useState<'26' | '34'>('26');
  const [facilityCode, setFacilityCode] = useState('123');
  const [cardNumber, setCardNumber] = useState('45678');

  const outcome = useMemo((): {result: WiegandDecode} | {error: string} => {
    try {
      if (mode === 'encode') {
        const fc = Number(facilityCode);
        const cn = Number(cardNumber);
        if (!Number.isFinite(fc) || !Number.isFinite(cn)) {
          return {error: 'Facility code and card number must be numbers.'};
        }
        return {
          result: bitLength === '26' ? encodeWiegand26(fc, cn) : encodeWiegand34(fc, cn),
        };
      }
      const cleaned = rawInput.trim();
      if (!cleaned) return {error: 'Enter the bits or hex a reader reported.'};
      // A string of only 0s and 1s at the expected width is bits; anything else is hex.
      const looksLikeBits =
        /^[01\s]+$/.test(cleaned) && cleaned.replace(/\s/g, '').length === Number(bitLength);
      return {
        result: looksLikeBits
          ? decodeWiegandBits(cleaned)
          : decodeWiegandHex(cleaned, Number(bitLength) as 26 | 34),
      };
    } catch (error) {
      return {error: describeError(error)};
    }
  }, [mode, rawInput, bitLength, facilityCode, cardNumber]);

  return (
    <>
      <Card
        title="Wiegand access badges"
        subtitle="Move between the number printed on a badge and the bits its reader emits.">
        <Segmented
          options={[
            {value: 'decode' as const, label: 'Bits → numbers'},
            {value: 'encode' as const, label: 'Numbers → bits'},
          ]}
          value={mode}
          onChange={setMode}
        />
        <Segmented
          options={[
            {value: '26' as const, label: '26-bit'},
            {value: '34' as const, label: '34-bit'},
          ]}
          value={bitLength}
          onChange={setBitLength}
        />

        {mode === 'decode' ? (
          <Field
            label="BITS OR HEX"
            value={rawInput}
            onChangeText={setRawInput}
            multiline
            monospace
            autoCapitalize="characters"
            placeholder="10000000100000000000000010 or 2004DEAD"
          />
        ) : (
          <>
            <Field
              label={`FACILITY CODE (0–${bitLength === '26' ? 255 : 65535})`}
              value={facilityCode}
              onChangeText={setFacilityCode}
              keyboardType="number-pad"
            />
            <Field
              label="CARD NUMBER (0–65535)"
              value={cardNumber}
              onChangeText={setCardNumber}
              keyboardType="number-pad"
            />
          </>
        )}
      </Card>

      {'error' in outcome ? (
        <Banner tone="danger">{outcome.error}</Banner>
      ) : (
        <>
          <Card title={outcome.result.format}>
            <CopyRow label="FACILITY CODE" value={String(outcome.result.facilityCode)} />
            <CopyRow label="CARD NUMBER" value={String(outcome.result.cardNumber)} />
            <CopyRow label="BITS" value={outcome.result.bits} />
            <CopyRow
              label="HEX"
              value={outcome.result.hex}
              hint={`${outcome.result.bitLength} bits, left-padded to whole bytes`}
            />
          </Card>

          <Banner tone={outcome.result.parityValid ? 'success' : 'warning'}>
            {outcome.result.parityValid
              ? 'Both parity bits check out — this is a well-formed Wiegand value.'
              : `Parity mismatch (leading ${
                  outcome.result.leadingParityValid ? 'ok' : 'bad'
                }, trailing ${
                  outcome.result.trailingParityValid ? 'ok' : 'bad'
                }). The bits may be truncated or in a different format.`}
          </Banner>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* EM4100                                                                      */
/* -------------------------------------------------------------------------- */

type Em4100Mode = 'hex' | 'parts';

function Em4100Tool() {
  const [mode, setMode] = useState<Em4100Mode>('hex');
  const [hex, setHex] = useState('0600BC1F2C');
  const [customerCode, setCustomerCode] = useState('6');
  const [cardNumber, setCardNumber] = useState('12328748');

  const outcome = useMemo(() => {
    try {
      if (mode === 'hex') {
        if (!hex.trim()) return {error: 'Enter the tag ID printed on the fob.'};
        return {result: em4100FromHex(hex)};
      }
      const cc = Number(customerCode);
      const cn = Number(cardNumber);
      if (!Number.isInteger(cc) || !Number.isInteger(cn)) {
        return {error: 'Customer code and card number must be whole numbers.'};
      }
      return {result: em4100FromParts(cc, cn)};
    } catch (error) {
      return {error: describeError(error)};
    }
  }, [mode, hex, customerCode, cardNumber]);

  return (
    <>
      <Card
        title="EM4100 / EM4102 fobs"
        subtitle="The 125 kHz tags used for building doors. Every vendor prints the same 40 bits differently.">
        <Segmented
          options={[
            {value: 'hex' as const, label: 'From hex'},
            {value: 'parts' as const, label: 'From parts'},
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'hex' ? (
          <Field
            label="TAG ID (10 HEX DIGITS)"
            value={hex}
            onChangeText={setHex}
            monospace
            autoCapitalize="characters"
            placeholder="0600BC1F2C"
          />
        ) : (
          <>
            <Field
              label="CUSTOMER / VERSION CODE (0–255)"
              value={customerCode}
              onChangeText={setCustomerCode}
              keyboardType="number-pad"
            />
            <Field
              label="CARD NUMBER (32-BIT)"
              value={cardNumber}
              onChangeText={setCardNumber}
              keyboardType="number-pad"
            />
          </>
        )}
        <Muted>
          An iPhone cannot read 125 kHz tags — Core NFC is 13.56 MHz only. Use this to convert
          numbers you already have from a badge or a desktop reader.
        </Muted>
      </Card>

      {'error' in outcome ? (
        <Banner tone="danger">{outcome.error}</Banner>
      ) : (
        <Card title="Printed formats">
          <CopyRow label="FULL HEX" value={outcome.result.hex} hint="40 bits" />
          <CopyRow label="CUSTOMER CODE" value={String(outcome.result.customerCode)} />
          <CopyRow label="10-DIGIT DECIMAL" value={outcome.result.decimal10} hint="Low 32 bits" />
          <CopyRow label="3,5 SPLIT" value={outcome.result.split35} hint="Low 24 bits" />
          <CopyRow label="5-DIGIT DECIMAL" value={outcome.result.decimal5} hint="Low 16 bits" />
          <CopyRow label="FULL DECIMAL" value={outcome.result.decimal40} />
          <CopyRow label="REVERSED HEX" value={outcome.result.reversedHex} />
        </Card>
      )}
    </>
  );
}
