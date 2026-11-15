ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_method_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_method_check CHECK (method IN ('amazon','apple','ach','bonus'));
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS bonus_week text;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_bonus_week_uniq ON public.transactions (user_id, bonus_week) WHERE bonus_week IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tx_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- trusted server (service role)
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.method = 'bonus' THEN RAISE EXCEPTION 'Forbidden'; END IF;
    NEW.user_id := auth.uid();
    NEW.rate := COALESCE((SELECT rate FROM public.rates WHERE method = NEW.method), 0);
    NEW.status := 'pending'; NEW.paid := false; NEW.created_at := now(); NEW.bonus_week := NULL;
  ELSIF NOT public.has_role(auth.uid(),'admin') THEN
    NEW.user_id := OLD.user_id; NEW.rate := OLD.rate; NEW.status := OLD.status;
    NEW.paid := OLD.paid; NEW.method := OLD.method; NEW.created_at := OLD.created_at; NEW.bonus_week := OLD.bonus_week;
  END IF;
  RETURN NEW;
END $$;