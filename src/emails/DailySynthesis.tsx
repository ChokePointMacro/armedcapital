import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';

export interface DailySynthesisEmailProps {
  date: Date;
  /** Phase 0 placeholder — Phase 4 will populate with real content. */
  headlines?: { title: string; summary: string }[];
}

/**
 * Phase 0 placeholder for the daily intelligence synthesis email.
 * Phase 4 fleshes this out with real headlines, market signals, and
 * the day's Claude-generated summary.
 *
 * Default export so the React Email dev preview (`npm run email`) picks
 * it up automatically.
 */
export default function DailySynthesisEmail({
  date,
  headlines = [],
}: DailySynthesisEmailProps) {
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Html>
      <Head />
      <Preview>Armed Capital — Daily Synthesis ({dateStr})</Preview>
      <Tailwind>
        <Body className="bg-black text-white font-mono">
          <Container className="mx-auto p-6 max-w-2xl">
            <Heading className="text-2xl text-orange-500 mb-2">
              Armed Capital
            </Heading>
            <Text className="text-xs uppercase tracking-widest text-gray-400 mb-6">
              Daily Synthesis · {dateStr}
            </Text>

            {headlines.length === 0 ? (
              <Section className="border border-gray-800 p-4">
                <Text className="text-gray-400 text-sm">
                  Phase 0 placeholder. Phase 4 will populate this template
                  with the day&apos;s top market headlines, AI synthesis,
                  and signals.
                </Text>
              </Section>
            ) : (
              headlines.map((h, i) => (
                <Section key={i} className="border-b border-gray-800 py-4">
                  <Heading as="h2" className="text-base text-orange-400 mb-2">
                    {h.title}
                  </Heading>
                  <Text className="text-gray-300 text-sm">{h.summary}</Text>
                </Section>
              ))
            )}

            <Text className="text-xs text-gray-600 mt-8">
              Sent by Armed Capital · ChokePoint Macro
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
