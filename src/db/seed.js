const BASE_URL = "http://localhost:8000";

const fixtures = [
  {
    sport: "football",
    homeTeam: "Manchester United",
    awayTeam: "Arsenal",
    startTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // started 30 min ago → live
    endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    homeScore: 1,
    awayScore: 0,
  },
  {
    sport: "basketball",
    homeTeam: "LA Lakers",
    awayTeam: "Boston Celtics",
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2h from now → scheduled
    endTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  },
];

for (const fixture of fixtures) {
  const res = await fetch(`${BASE_URL}/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fixture),
  });

  const body = await res.json();
  if (res.ok) {
    console.log(
      `Created [${body.data.status}] ${fixture.homeTeam} vs ${fixture.awayTeam} — id ${body.data.id}`,
    );
  } else {
    console.error(`Failed ${fixture.homeTeam} vs ${fixture.awayTeam}:`, body);
  }
}
