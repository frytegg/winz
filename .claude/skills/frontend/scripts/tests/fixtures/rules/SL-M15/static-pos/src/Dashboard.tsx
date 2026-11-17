import { Card, CardContent } from '@/components/ui/card';

export function Dashboard() {
  return (
    <Card>
      <CardContent>
        <Card>
          <CardContent>Nested</CardContent>
        </Card>
        <div className="rounded-xl border p-4">Inner panel</div>
      </CardContent>
    </Card>
  );
}
