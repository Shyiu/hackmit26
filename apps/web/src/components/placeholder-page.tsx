import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Not built yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Wire this up once the perception service and MongoDB collections behind it exist.
          See README.md for the spec.
        </CardContent>
      </Card>
    </div>
  );
}
