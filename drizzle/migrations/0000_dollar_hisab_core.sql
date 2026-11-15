CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_id bigint NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'User',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "own role read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.rates (
  method text PRIMARY KEY,
  rate numeric NOT NULL CHECK (rate >= 0 AND rate < 10000)
);
GRANT SELECT, INSERT, UPDATE ON public.rates TO authenticated;
GRANT ALL ON public.rates TO service_role;
ALTER TABLE public.rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rates read" ON public.rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "rates admin insert" ON public.rates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "rates admin update" ON public.rates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
INSERT INTO public.rates (method, rate) VALUES ('amazon',80),('apple',85),('ach',95);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  method text NOT NULL CHECK (method IN ('amazon','apple','ach')),
  usd numeric NOT NULL CHECK (usd > 0 AND usd < 100000),
  rate numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
  paid boolean NOT NULL DEFAULT false,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 500),
  site text NOT NULL CHECK (length(site) BETWEEN 1 AND 100),
  img_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.transactions (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tx read" ON public.transactions FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "tx insert own" ON public.transactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "tx update" ON public.transactions FOR UPDATE TO authenticated USING ((user_id = auth.uid() AND status = 'pending') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "tx delete admin" ON public.transactions FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.tx_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.user_id := auth.uid();
    NEW.rate := COALESCE((SELECT rate FROM public.rates WHERE method = NEW.method), 0);
    NEW.status := 'pending'; NEW.paid := false; NEW.created_at := now();
  ELSIF NOT public.has_role(auth.uid(),'admin') THEN
    NEW.user_id := OLD.user_id; NEW.rate := OLD.rate; NEW.status := OLD.status;
    NEW.paid := OLD.paid; NEW.method := OLD.method; NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tx_guard BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.tx_guard();

CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payouts TO authenticated;
GRANT ALL ON public.payouts TO service_role;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout read" ON public.payouts FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  expiry timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices read" ON public.devices FOR SELECT TO authenticated USING (true);
CREATE POLICY "devices admin insert" ON public.devices FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "devices admin delete" ON public.devices FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.mark_all_paid() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  INSERT INTO public.payouts (user_id, amount)
    SELECT user_id, SUM(usd*rate) FROM public.transactions WHERE status='approved' AND NOT paid GROUP BY user_id;
  UPDATE public.transactions SET paid = true WHERE status='approved' AND NOT paid;
END $$;
GRANT EXECUTE ON FUNCTION public.mark_all_paid() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_leaderboard() RETURNS TABLE(name text, total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.name, COALESCE(SUM(t.usd*t.rate),0) AS total
  FROM public.profiles p JOIN public.transactions t ON t.user_id = p.id AND t.status='approved'
  GROUP BY p.id, p.name ORDER BY total DESC LIMIT 20
$$;
GRANT EXECUTE ON FUNCTION public.get_leaderboard() TO authenticated;

CREATE POLICY "proofs insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "proofs read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proofs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(),'admin')));